import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/grant
 * Body: { user_id: string, days?: number, reason: string }
 *
 * Grants N days (default 30) of Pro access to the target user. Bumps
 * users.tier='pro' and extends users.tier_expires_at to max(current, now+days).
 * Logs to admin_audit_log.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { user_id?: string; days?: number; reason?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!body.user_id || reason.length < 5 || reason.length > 500) {
      return NextResponse.json({ error: "user_id and a reason between 5 and 500 characters are required" }, { status: 400 });
    }
    const days = body.days === undefined ? 30 : Number(body.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return NextResponse.json({ error: "days must be a whole number between 1 and 365" }, { status: 400 });
    }

    const { data: newExpiry, error } = await getServiceClient().rpc("admin_grant_entitlement", {
      p_actor_id: actor.userId,
      p_target_user_id: body.user_id,
      p_days: days,
      p_reason: reason,
      p_audit_context: {
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      },
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404
        : error.code === "23514" ? 409 : error.code === "22023" ? 400 : 500;
      return NextResponse.json({ error: status === 500 ? "Failed to grant access" : error.message }, { status });
    }

    return NextResponse.json({
      ok: true,
      new_expiry: new Date(newExpiry as string).toISOString(),
    });
  },
  { route: "/api/admin/users/grant", rateLimit: { limit: 20, windowMs: 60_000 } }
);
