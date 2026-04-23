import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/grant
 * Body: { user_id: string, days?: number }
 *
 * Grants N days (default 30) of Pro access to the target user. Bumps
 * users.tier='pro' and extends users.tier_expires_at to max(current, now+days).
 * Logs to admin_audit_log.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { user_id?: string; days?: number };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.user_id) {
      return NextResponse.json({ error: "user_id required" }, { status: 400 });
    }
    const days = Math.max(
      1,
      Math.min(365, Math.floor(Number(body.days) || 30))
    );

    const sb = getServiceClient();
    const { data: current, error: fetchErr } = await sb
      .from("users")
      .select("id, tier, tier_expires_at, email")
      .eq("id", body.user_id)
      .maybeSingle();
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = new Date();
    const existingExpiry = current.tier_expires_at
      ? new Date(current.tier_expires_at as string)
      : null;
    const base =
      existingExpiry && existingExpiry.getTime() > now.getTime()
        ? existingExpiry
        : now;
    const newExpiry = new Date(base.getTime() + days * 86400_000);

    const { error: updErr } = await sb
      .from("users")
      .update({
        tier: "pro",
        tier_expires_at: newExpiry.toISOString(),
      })
      .eq("id", body.user_id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "grant_free_access",
      targetType: "user",
      targetId: body.user_id,
      payload: {
        days,
        new_expiry: newExpiry.toISOString(),
        previous_expiry: current.tier_expires_at,
        previous_tier: current.tier,
        target_email: current.email,
      },
    });

    return NextResponse.json({
      ok: true,
      new_expiry: newExpiry.toISOString(),
    });
  },
  { route: "/api/admin/users/grant", rateLimit: { limit: 20, windowMs: 60_000 } }
);
