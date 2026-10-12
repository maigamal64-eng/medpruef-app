import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/lock
 * Body: { user_id: string, lock: boolean, reason?: string }
 *
 * Toggles users.is_banned (our existing schema uses is_banned, not
 * is_locked; see src/lib/auth-guard.ts). Audit-logged.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { user_id?: string; lock?: boolean; reason?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.user_id || typeof body.lock !== "boolean") {
      return NextResponse.json(
        { error: "user_id and boolean lock required" },
        { status: 400 }
      );
    }

    // Prevent admins from locking themselves out.
    if (body.user_id === actor.userId && body.lock) {
      return NextResponse.json(
        { error: "Cannot lock your own account" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();
    const { data: current, error: fetchErr } = await sb
      .from("users")
      .select("id, email, is_banned, role")
      .eq("id", body.user_id)
      .maybeSingle();
    if (fetchErr) {
      return adminErrorResponse(fetchErr, "/api/admin/users/lock");
    }
    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Block locking fellow admins — keeps a runaway admin session from
    // removing everyone else's access.
    if (current.role === "admin" && body.lock && body.user_id !== actor.userId) {
      return NextResponse.json(
        {
          error:
            "Refusing to lock a fellow admin. Demote the user first, then lock.",
        },
        { status: 403 }
      );
    }

    const { error: updErr } = await sb
      .from("users")
      .update({ is_banned: body.lock })
      .eq("id", body.user_id);
    if (updErr) {
      return adminErrorResponse(updErr, "/api/admin/users/lock");
    }

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: body.lock ? "lock_user" : "unlock_user",
      targetType: "user",
      targetId: body.user_id,
      payload: {
        reason: body.reason ?? null,
        target_email: current.email,
        previous_is_banned: !!current.is_banned,
      },
    });

    return NextResponse.json({ ok: true });
  },
  { route: "/api/admin/users/lock", rateLimit: { limit: 20, windowMs: 60_000 } }
);
