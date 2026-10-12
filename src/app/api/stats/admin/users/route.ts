import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { requireAdmin } from "@/lib/auth-guard";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { escapeLike, planProfileEdit } from "@/lib/admin/profile-edit";
import { isSystemEvent, latestStamp } from "@/lib/admin/learner-activity";
import { USER_SEGMENTS, isMissingFunction, segmentNeedsRevenue, type UserSegment } from "@/lib/admin/learner-segments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";
export const maxDuration = 60;


interface LockedUserRow {
  id: string;
  telegram_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  telegram_username: string | null;
  photo_url: string | null;
  role: string | null;
  tier: string | null;
  created_at: string;
  updated_at: string | null;
  user_gamification: Array<{
    total_xp: number | null;
    current_streak: number | null;
    total_questions_answered: number | null;
    total_correct: number | null;
    daily_questions_today: number | null;
    last_study_date: string | null;
  }> | { total_xp: number | null } | null;
}

/**
 * Latest learner activity for a handful of accounts (ADM-07 A): answers,
 * learner events and session starts. Never users.updated_at.
 */
async function learnerLastActive(ids: string[]): Promise<Map<string, string | null>> {
  const db = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
  const out = new Map<string, string | null>();
  await Promise.all(ids.map(async (id) => {
    const [answer, events, session] = await Promise.all([
      db.from("answer_history").select("created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(1),
      db.from("user_events").select("event_type, created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
      db.from("user_sessions").select("started_at").eq("user_id", id).order("started_at", { ascending: false }).limit(1),
    ]);
    for (const r of [answer, events, session]) if (r.error) throw r.error;
    const event = (events.data ?? []).find((e) => !isSystemEvent(e.event_type as string));
    out.set(id, latestStamp([
      answer.data?.[0]?.created_at as string | undefined,
      event?.created_at as string | undefined,
      session.data?.[0]?.started_at as string | undefined,
    ]));
  }));
  return out;
}

/**
 * Locked accounts are few, so this view reads them directly (newest first)
 * instead of extending the directory RPC. Last active follows the learner
 * activity rule above.
 */
async function lockedDirectory(query: string, limit: number, offset: number, page: number, canReadRevenue: boolean) {
  let request = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS })
    .from("users")
    .select("id, telegram_id, email, first_name, last_name, telegram_username, photo_url, role, tier, created_at, updated_at, user_gamification(total_xp, current_streak, total_questions_answered, total_correct, daily_questions_today, last_study_date)", { count: "exact" })
    .eq("is_banned", true)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (query) {
    const safe = query.replace(/[,()]/g, " ");
    request = request.or(`email.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,telegram_username.ilike.%${safe}%`);
  }
  const { data, count, error } = await request;
  if (error) throw error;
  const rows = (data ?? []) as unknown as LockedUserRow[];
  const lastActiveById = await learnerLastActive(rows.map((u) => u.id));
  const items = rows.map((u) => {
    const game = ((Array.isArray(u.user_gamification) ? u.user_gamification[0] : u.user_gamification) ?? {}) as Record<string, number | string | null>;
    const answered = Number(game.total_questions_answered ?? 0);
    const correct = Number(game.total_correct ?? 0);
    const lastActive = lastActiveById.get(u.id) ?? null;
    const age = lastActive ? Date.now() - new Date(lastActive).getTime() : Number.POSITIVE_INFINITY;
    return {
      id: u.id,
      telegram_id: u.telegram_id,
      email: u.email,
      name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.telegram_username || u.email || "Anonymous",
      first_name: u.first_name,
      last_name: u.last_name,
      username: u.telegram_username,
      photo_url: u.photo_url,
      role: u.role ?? "user",
      tier: canReadRevenue ? (u.tier ?? "free") : null,
      status: !lastActive ? "none" : age <= 86_400_000 ? "active" : age <= 7 * 86_400_000 ? "recent" : "inactive",
      created_at: u.created_at,
      xp: Number(game.total_xp ?? 0),
      streak: Number(game.current_streak ?? 0),
      questions_answered: answered,
      accuracy: answered > 0 ? Math.round((100 * correct) / answered) : 0,
      daily_today: Number(game.daily_questions_today ?? 0),
      last_study: (game.last_study_date as string | null) ?? null,
      last_active: lastActive,
      is_banned: true,
    };
  });
  const total = count ?? 0;
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
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
    const segment = (params.get("segment") ?? "all") as UserSegment | "all";
    if (segment !== "all" && !USER_SEGMENTS.includes(segment)) {
      return NextResponse.json({ error: "Invalid user directory query" }, { status: 400 });
    }
    if (!canReadRevenue && (tier !== "all" || sort === "tier" || (segment !== "all" && segmentNeedsRevenue(segment)))) {
      return NextResponse.json({ error: "Revenue permission required for entitlement filters" }, { status: 403 });
    }
    // UX-ADM-19: counts per segment (learners only). Needs the a16 changeset.
    if (params.get("view") === "segments") {
      const { data, error } = await getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS }).rpc("admin_user_segment_counts");
      if (error && isMissingFunction(error)) return NextResponse.json({ available: false, counts: null });
      if (error) return adminErrorResponse(error, "/api/stats/admin/users");
      const counts = { ...(data as Record<string, number>) };
      if (!canReadRevenue) delete counts.pro_inactive_7d;
      return NextResponse.json({ available: true, counts });
    }
    // Page cap lowered 100 -> 50 (W2-DB1). The admin UI asks for 25. Note:
    // admin_user_directory enriches every user before paging, so the real
    // timeout fix is the user_events (user_id, created_at) index in
    // 20261014100000_study_rpc_perf.sql, not the page size.
    const allowedSorts = ["name", "role", "tier", "status", "xp", "streak", "questions_answered", "accuracy", "last_active", "created_at"];
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
        !Number.isSafeInteger(offset) || offset > 2_147_483_647 ||
        rawQuery.length > 200 || (rawQuery !== "" && (query.length < 2 || query.length > 100)) ||
        !["all", "free", "pro", "admin"].includes(tier) || !["all", "email", "telegram"].includes(auth) ||
        !allowedSorts.includes(sort) || !["asc", "desc"].includes(order)) {
      return NextResponse.json({ error: "Invalid user directory query" }, { status: 400 });
    }
    if (params.get("locked") === "1") {
      if (segment !== "all") return NextResponse.json({ error: "Segments and the locked view cannot be combined" }, { status: 400 });
      return NextResponse.json({ ...(await lockedDirectory(query, limit, offset, page, canReadRevenue)), activity_basis: "learner" });
    }
    // a16: v2 computes last active from learner activity only and filters by
    // segment. Until the changeset is applied, fall back to v1 (its last
    // active still includes profile updates) and refuse segment filters.
    let activityBasis: "learner" | "legacy" = "learner";
    let { data, error } = await getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS }).rpc("admin_user_directory_v2", {
      p_q: query || null,
      p_tier: tier,
      p_auth: auth,
      p_segment: segment,
      p_sort: sort,
      p_order: order,
      p_limit: limit,
      p_offset: offset,
    });
    if (error && isMissingFunction(error)) {
      if (segment !== "all") {
        return NextResponse.json({ error: "Segments are not available until the a16 database changeset is applied." }, { status: 503 });
      }
      activityBasis = "legacy";
      ({ data, error } = await getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS }).rpc("admin_user_directory", {
        p_q: query || null,
        p_tier: tier,
        p_auth: auth,
        p_sort: sort,
        p_order: order,
        p_limit: limit,
        p_offset: offset,
      }));
    }
    if (error) {
      console.error("[admin/users GET] directory RPC failed", error.code);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }
    const result = data as { items?: Array<{ id: string; tier: string | null }>; total?: number } | null;
    const total = Number(result?.total ?? 0);
    const totalPages = Math.ceil(total / limit);
    const items = result?.items ?? [];
    // UX-ADM-18: the directory RPC has no lock state; read it for this page.
    const banned = new Set<string>();
    if (items.length > 0) {
      const { data: lockRows, error: lockError } = await getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS })
        .from("users")
        .select("id")
        .in("id", items.map((item) => item.id))
        .eq("is_banned", true);
      if (lockError) return adminErrorResponse(lockError, "/api/stats/admin/users");
      for (const row of lockRows ?? []) banned.add(row.id as string);
    }
    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        tier: canReadRevenue ? item.tier : null,
        is_banned: banned.has(item.id),
      })),
      total,
      page,
      limit,
      totalPages,
      activity_basis: activityBasis,
    });
  } catch (err) {
    console.error("[admin/users GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH — Edit profile fields and reset gamification (ADM-06). Emails are
// normalized like login (trim + lowercase), validated and checked for
// duplicates; the audit row keeps before/after values and a reset keeps a
// copy of the previous gamification row so both can be restored by hand.
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  const route = "/api/stats/admin/users";
  try {
    const db = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
    const body = await req.json().catch(() => null);
    const userId = body?.userId;
    const updates = body?.updates;

    if (typeof userId !== "string" || !UUID_RE.test(userId) || !updates || typeof updates !== "object") {
      return NextResponse.json({ error: "userId and updates required" }, { status: 400 });
    }
    if (Object.prototype.hasOwnProperty.call(updates, "role")) {
      return NextResponse.json({ error: "Admin access changes must use the audited access membership workflow" }, { status: 409 });
    }
    if (Object.prototype.hasOwnProperty.call(updates, "tier")) {
      return NextResponse.json({ error: "Entitlement changes must use the audited entitlement workflow" }, { status: 409 });
    }

    const { data: current, error: readError } = await db
      .from("users")
      .select("id, email, first_name, last_name")
      .eq("id", userId)
      .maybeSingle();
    if (readError) return adminErrorResponse(readError, route);
    if (!current) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const plan = planProfileEdit(current, updates);
    if ("error" in plan) return NextResponse.json({ error: plan.error }, { status: 400 });
    const userUpdates = plan.changes;

    if (typeof userUpdates.email === "string") {
      const { data: clash, error: clashError } = await db
        .from("users")
        .select("id")
        .ilike("email", escapeLike(userUpdates.email))
        .neq("id", userId)
        .limit(1);
      if (clashError) return adminErrorResponse(clashError, route);
      if (clash && clash.length > 0) {
        return NextResponse.json({ error: "Another account already uses this email" }, { status: 409 });
      }
    }

    if (Object.keys(userUpdates).length > 0) {
      const { error } = await db
        .from("users")
        .update({ ...userUpdates, updated_at: new Date().toISOString() })
        .eq("id", userId);
      if (error?.code === "23505") {
        return NextResponse.json({ error: "Another account already uses this email" }, { status: 409 });
      }
      if (error) return adminErrorResponse(error, route);
    }

    let previousGamification: Record<string, unknown> | null = null;
    if (updates.reset_gamification === true) {
      const { data: before, error: beforeError } = await db
        .from("user_gamification")
        .select("total_xp, current_streak, longest_streak, total_questions_answered, total_correct, daily_questions_today, level, rank_name, last_study_date")
        .eq("user_id", userId)
        .maybeSingle();
      if (beforeError) return adminErrorResponse(beforeError, route);
      previousGamification = before ?? null;
      const { error: resetError } = await db.from("user_gamification").update({
        total_xp: 0, current_streak: 0, longest_streak: 0,
        total_questions_answered: 0, total_correct: 0,
        daily_questions_today: 0, level: 1, rank_name: "Praktikant",
      }).eq("user_id", userId);
      if (resetError) return adminErrorResponse(resetError, route);
    }

    const changed = Object.keys(userUpdates);
    const actorEmail = await resolveActorEmail(guard.userId);
    await logAdminAction({
      req,
      actorId: guard.userId,
      actorEmail,
      action: updates.reset_gamification === true ? "reset_user_gamification" : "edit_user",
      targetType: "user",
      targetId: userId,
      payload: {
        applied_fields: changed,
        before: Object.fromEntries(changed.map((key) => [key, (current as Record<string, unknown>)[key] ?? null])),
        after: userUpdates,
        reset_gamification: updates.reset_gamification === true,
        ...(previousGamification ? { previous_gamification: previousGamification } : {}),
      },
    });

    return NextResponse.json({ ok: true, applied_fields: changed });
  } catch (err) {
    return adminErrorResponse(err, route);
  }
}

// DELETE is disabled until the tracked erasure workflow can prove complete cleanup.
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  return NextResponse.json({ error: "Direct account deletion is disabled. Use the tracked erasure workflow." }, { status: 410 });
}
