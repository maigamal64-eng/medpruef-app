import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth-guard";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";

export const dynamic = "force-dynamic";

interface UserRow {
  id: string;
  telegram_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  telegram_username: string | null;
  photo_url: string | null;
  role: string;
  tier: string | null;
  created_at: string;
  updated_at: string;
  user_gamification: {
    total_xp: number;
    current_streak: number;
    total_questions_answered: number;
    total_correct: number;
    daily_questions_today: number;
    last_study_date: string | null;
  }[] | null;
}

// GET — Search and page through the user directory. Aggregation and sorting
// run in the database so page boundaries do not change the global order.
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const permissionSnapshot = await loadAdminPermissionSnapshot(guard.userId);
    const canReadRevenue = canAccessAdminPermission(permissionSnapshot, "revenue.read");
    const params = req.nextUrl.searchParams;
    const page = Number(params.get("page") ?? 1);
    const limit = Number(params.get("limit") ?? 25);
    const rawQuery = params.get("q")?.trim() ?? "";
    const query = rawQuery.replace(/[^\p{L}\p{N}@.+\- ]/gu, " ").replace(/\s+/g, " ").trim();
    const tier = params.get("tier") ?? "all";
    const auth = params.get("auth") ?? "all";
    const sort = params.get("sort") ?? "last_active";
    const order = params.get("order") ?? "desc";
    if (!canReadRevenue && (tier !== "all" || sort === "tier")) {
      return NextResponse.json({ error: "Revenue permission required for entitlement filters" }, { status: 403 });
    }
    const allowedSorts = ["name", "role", "tier", "status", "xp", "streak", "questions_answered", "accuracy", "last_active", "created_at"];
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset > 2_147_483_647 ||
        rawQuery.length > 200 || (rawQuery !== "" && (query.length < 2 || query.length > 100)) ||
        !["all", "free", "pro", "admin"].includes(tier) || !["all", "email", "telegram"].includes(auth) ||
        !allowedSorts.includes(sort) || !["asc", "desc"].includes(order)) {
      return NextResponse.json({ error: "Invalid user directory query" }, { status: 400 });
    }
    const { data, error } = await getServiceClient().rpc("admin_user_directory", {
      p_q: query || null,
      p_tier: tier,
      p_auth: auth,
      p_sort: sort,
      p_order: order,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) {
      console.error("[admin/users GET] directory RPC failed", error.code);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }
    const result = data as { items?: UserRow[]; total?: number } | null;
    const total = Number(result?.total ?? 0);
    const totalPages = Math.ceil(total / limit);
    return NextResponse.json({
      items: (result?.items ?? []).map((item) => ({
        ...item,
        tier: canReadRevenue ? item.tier : null,
      })),
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    console.error("[admin/users GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH — Edit profile fields and reset gamification.
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const body = await req.json();
    const { userId, updates } = body;

    if (!userId || !updates || typeof updates !== "object") return NextResponse.json({ error: "userId and updates required" }, { status: 400 });
    if (Object.prototype.hasOwnProperty.call(updates, "role")) {
      return NextResponse.json({ error: "Admin access changes must use the audited access membership workflow" }, { status: 409 });
    }
    if (Object.prototype.hasOwnProperty.call(updates, "tier")) {
      return NextResponse.json({ error: "Entitlement changes must use the audited entitlement workflow" }, { status: 409 });
    }

    // Update profile-only fields. Role and entitlement changes use separate workflows.
    const userUpdates: Record<string, unknown> = {};
    if (updates.first_name !== undefined) userUpdates.first_name = updates.first_name;
    if (updates.last_name !== undefined) userUpdates.last_name = updates.last_name;
    if (updates.email !== undefined) userUpdates.email = updates.email;

    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updated_at = new Date().toISOString();
      const { error } = await db.from("users").update(userUpdates).eq("id", userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reset gamification if requested
    if (updates.reset_gamification) {
      await db.from("user_gamification").update({
        total_xp: 0, current_streak: 0, longest_streak: 0,
        total_questions_answered: 0, total_correct: 0,
        daily_questions_today: 0, level: 1, rank_name: "Praktikant",
      }).eq("user_id", userId);
    }

    const actorEmail = await resolveActorEmail(guard.userId);
    await logAdminAction({
      req,
      actorId: guard.userId,
      actorEmail,
      action: updates.reset_gamification ? "reset_user_gamification" : "edit_user",
      targetType: "user",
      targetId: userId,
      payload: {
        applied_fields: Object.keys(userUpdates).filter((k) => k !== "updated_at"),
        reset_gamification: !!updates.reset_gamification,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/users PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE is disabled until the tracked erasure workflow can prove complete cleanup.
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  return NextResponse.json({ error: "Direct account deletion is disabled. Use the tracked erasure workflow." }, { status: 410 });
}
