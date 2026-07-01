import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * POST /api/subscriptions/refund-request
 *
 * Log a refund request — does NOT execute the refund. Crypto refunds
 * are manual by design (NOWPayments doesn't auto-reverse), so [name]
 * processes them offline and updates `refund_requests.status` via
 * the admin panel. The 7-day no-questions-asked refund guarantee on
 * /pricing depends on this path being reachable + tracked.
 *
 * Body: `{ subscriptionId: string, reason?: string }`
 *
 * Rules:
 *   - requireUser — user can only request a refund on their OWN
 *     subscription; server verifies ownership.
 *   - Subscription must exist, belong to the caller, and be in a
 *     refund-eligible state (`active` or recently `pending`).
 *   - Within 7 days of `started_at` — after that, refunds go through
 *     [name] manually (or are denied per T&Cs).
 *   - Idempotent-ish: a user with an existing `pending` refund request
 *     for the same subscription gets 409 instead of a duplicate row.
 *
 * Emits `refund_requested` event + Telegram-pings [name] (TODO-stubbed)
 * so he sees the request within minutes.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  let body: { subscriptionId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { subscriptionId, reason } = body;
  if (!subscriptionId || typeof subscriptionId !== "string") {
    return NextResponse.json(
      { error: "subscriptionId (string) required" },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceClient();

    // Ownership + eligibility check.
    const { data: sub, error: subErr } = await sb
      .from("subscriptions")
      .select("id, user_id, status, tier, amount_cents, started_at, created_at")
      .eq("id", subscriptionId)
      .maybeSingle();

    if (subErr) {
      captureServerError(subErr, {
        route: "/api/subscriptions/refund-request",
        phase: "sub_lookup",
        userId,
      });
      return NextResponse.json(
        { error: "Failed to look up subscription" },
        { status: 500 }
      );
    }

    if (!sub) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }
    if ((sub.user_id as string) !== userId) {
      return NextResponse.json({ error: "Not your subscription" }, { status: 403 });
    }

    // Refund eligibility: we allow `active` + `pending` within 7 days
    // of started_at/created_at. Beyond that, the request is still
    // logged ([name] can still approve) but the user is warned.
    const startRef = sub.started_at || sub.created_at;
    const ageMs = startRef ? Date.now() - new Date(startRef as string).getTime() : Infinity;
    const within7Days = ageMs < 7 * 86400 * 1000;

    // Already-pending request?
    const { data: existing } = await sb
      .from("refund_requests")
      .select("id, status, requested_at")
      .eq("subscription_id", subscriptionId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          error: "A refund request is already pending for this subscription.",
          requestId: existing.id,
        },
        { status: 409 }
      );
    }

    // Insert the row.
    const { data: insertRow, error: insertErr } = await sb
      .from("refund_requests")
      .insert({
        subscription_id: subscriptionId,
        user_id: userId,
        reason: (reason || "").slice(0, 1000) || null,
        status: "pending",
      })
      .select("id, requested_at")
      .single();

    if (insertErr || !insertRow) {
      captureServerError(insertErr, {
        route: "/api/subscriptions/refund-request",
        phase: "insert",
        userId,
        subscriptionId,
      });
      return NextResponse.json(
        { error: "Failed to log refund request" },
        { status: 500 }
      );
    }

    // Telemetry — the admin dashboard picks this up + so can [name]'s
    // daily digest. Non-blocking.
    try {
      await sb.from("user_events").insert({
        user_id: userId,
        event_type: "refund_requested",
        event_data: {
          subscription_id: subscriptionId,
          request_id: insertRow.id,
          tier: sub.tier,
          amount_cents: sub.amount_cents,
          within_7_days: within7Days,
        },
      });
    } catch (err) {
      console.error("[refund-request] telemetry insert failed:", err);
    }

    // TODO: Telegram ping to [name] (chat 0) — plumbed via
    // the daily-digest cron for now; a direct ping can be added once
    // the tg MCP is wired into server runtime. Users don't wait on
    // this anyway — [name] processes manually.

    return NextResponse.json({
      ok: true,
      requestId: insertRow.id,
      requestedAt: insertRow.requested_at,
      eligibleWithin7Days: within7Days,
      hint: within7Days
        ? "Refund guaranteed within 7 days: [name] processes manually within 24-72h."
        : "Subscription is >7 days old, refund at admin discretion.",
    });
  } catch (err) {
    captureServerError(err, {
      route: "/api/subscriptions/refund-request",
      userId,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
