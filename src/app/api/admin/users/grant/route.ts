import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { adminErrorResponse } from "@/lib/admin/error-response";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/users/grant
 * Body: { user_id: string, days?: number, reason: string }
 *
 * Grants N days (default 30) of Pro access to the target user. Bumps
 * users.tier='pro' and extends users.tier_expires_at to max(current, now+days).
 * Logs to admin_audit_log. Refuses permanent Pro (409) and replays an earlier
 * result for a repeated idempotency_key instead of stacking a second grant.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { user_id?: string; days?: number; reason?: string; idempotency_key?: string };
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

    if (!UUID_RE.test(body.user_id)) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
    }
    const idempotencyKey = typeof body.idempotency_key === "string" && UUID_RE.test(body.idempotency_key)
      ? body.idempotency_key.toLowerCase()
      : null;

    const db = getServiceClient();
    // ADM-06: a dated grant must never replace permanent Pro. The a13
    // migration enforces this in the database too; this check also holds
    // before that migration is applied.
    const { data: target, error: targetError } = await db
      .from("users")
      .select("tier, tier_expires_at")
      .eq("id", body.user_id)
      .maybeSingle();
    if (targetError) return adminErrorResponse(targetError, "/api/admin/users/grant");
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (target.tier === "pro" && !target.tier_expires_at) {
      return NextResponse.json({ error: "This learner already has permanent Pro. A dated grant would shorten it." }, { status: 409 });
    }

    // A retried submit of the same dialog must not stack a second grant.
    if (idempotencyKey) {
      const { data: prior, error: priorError } = await db
        .from("admin_audit_log")
        .select("payload")
        .eq("action", "grant_free_access")
        .eq("target_id", body.user_id)
        .eq("payload->>idempotency_key", idempotencyKey)
        .limit(1);
      if (priorError) return adminErrorResponse(priorError, "/api/admin/users/grant");
      const previous = prior?.[0]?.payload as { new_expiry?: string } | undefined;
      if (previous?.new_expiry) {
        return NextResponse.json({ ok: true, duplicate: true, new_expiry: new Date(previous.new_expiry).toISOString() });
      }
    }

    const { data: newExpiry, error } = await db.rpc("admin_grant_entitlement", {
      p_actor_id: actor.userId,
      p_target_user_id: body.user_id,
      p_days: days,
      p_reason: reason,
      p_audit_context: {
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      },
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404
        : error.code === "23514" || error.code === "55000" ? 409 : error.code === "22023" ? 400 : 500;
      return NextResponse.json({ error: status === 500 ? "Failed to grant access" : error.message }, { status });
    }

    return NextResponse.json({
      ok: true,
      new_expiry: new Date(newExpiry as string).toISOString(),
    });
  },
  { route: "/api/admin/users/grant", rateLimit: { limit: 20, windowMs: 60_000 } }
);
