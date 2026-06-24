/**
 * paymentFunnelMetrics — the read-only data behind /admin/payments (Gate 1,
 * 2026-06-24). Proves whether users factually tried to pay and where the flow
 * dropped, and makes a SILENT grant failure (e.g. WHOP_WEBHOOK_SECRET mismatch
 * → every real payment 401s with no row granted) loudly visible.
 *
 * READ-ONLY: every query is a SELECT/count; this never mutates.
 *
 * Two sources, joined into one picture:
 *   1. `payment_events` (this sprint) — the full funnel as the app observed it:
 *      checkout_session_created → checkout_redirected → webhook_received →
 *      grant_succeeded / grant_failed(reason) / checkout_failed(reason).
 *   2. `webhook_attempts` (existing, src/lib/webhook-logger.ts) — the
 *      authoritative inbound-delivery truth for whop, written BEFORE signature
 *      verification. "N received · M sig_invalid" is the exact signal that
 *      tells a real-payment-rejected-at-the-door failure apart from pure
 *      buyer abandonment (0 attempts received = Whop never reached us).
 *
 * Boundary: this module pulls getServiceClient-backed data and is imported
 * ONLY by the admin-shelled API route — NEVER by the client page (which takes
 * the TYPE + primitives only), mirroring controlPlaneMetrics.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** A single funnel step + its count in the window. */
export interface FunnelStep {
  key: string;
  label: string;
  count: number;
}

export interface PaymentFeedRow {
  id: number;
  event: string;
  provider: string;
  user_id: string | null;
  tier: string | null;
  payment_id: string | null;
  checkout_session_id: string | null;
  reason: string | null;
  signature_valid: boolean | null;
  matched: boolean | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
}

export interface WebhookDeliveryRow {
  id: string;
  result: string;
  signature_valid: boolean | null;
  event_id: string | null;
  error: string | null;
  received_at: string;
}

export interface PaymentFunnelMetrics {
  generated_at: string;
  window_days: number;
  /** The ordered funnel: created → redirected → webhook_received → granted. */
  funnel: FunnelStep[];
  /** Counts that don't belong on the linear funnel but matter. */
  totals: {
    checkout_failed: number;
    grant_failed: number;
    grant_succeeded: number;
    webhook_received: number;
    /** webhook_received rows where matched=false (unmatched delivery). */
    webhook_unmatched: number;
  };
  /** grant_failed + checkout_failed grouped by `reason` (named drop causes). */
  failure_reasons: Array<{ reason: string; count: number }>;
  /** Whop inbound-delivery truth from webhook_attempts (every delivery). */
  webhook_deliveries: {
    total: number;
    by_result: Record<string, number>;
    /** sig_invalid > 0 with grants = the secret-mismatch alarm. */
    sig_invalid: number;
    recent: WebhookDeliveryRow[];
  };
  /** The most recent payment_events, newest first (the live feed). */
  recent_events: PaymentFeedRow[];
  /**
   * The headline read: is the "0 successful payments" a 0-attempt story or a
   * broken-grant story? Computed from the above so the UI can lead with it.
   */
  diagnosis: string;
}

const WINDOW_DAYS = 30;
const FEED_LIMIT = 50;
const DELIVERY_LIMIT = 25;

async function countEvent(
  sb: SupabaseClient,
  event: string,
  sinceIso: string
): Promise<number> {
  const { count } = await sb
    .from("payment_events")
    .select("id", { count: "exact", head: true })
    .eq("event", event)
    .gte("created_at", sinceIso);
  return count ?? 0;
}

export async function computePaymentFunnelMetrics(
  sb: SupabaseClient
): Promise<PaymentFunnelMetrics> {
  const now = new Date();
  const nowIso = now.toISOString();
  const sinceIso = new Date(
    now.getTime() - WINDOW_DAYS * 86_400_000
  ).toISOString();

  const [
    created,
    redirected,
    webhookReceived,
    grantSucceeded,
    grantFailed,
    checkoutFailed,
    webhookUnmatchedRes,
    failureRowsRes,
    recentRes,
    deliveriesRes,
  ] = await Promise.all([
    countEvent(sb, "checkout_session_created", sinceIso),
    countEvent(sb, "checkout_redirected", sinceIso),
    countEvent(sb, "webhook_received", sinceIso),
    countEvent(sb, "grant_succeeded", sinceIso),
    countEvent(sb, "grant_failed", sinceIso),
    countEvent(sb, "checkout_failed", sinceIso),
    // unmatched webhook deliveries (matched=false)
    sb
      .from("payment_events")
      .select("id", { count: "exact", head: true })
      .eq("event", "webhook_received")
      .eq("matched", false)
      .gte("created_at", sinceIso),
    // failure reasons — grant_failed + checkout_failed, grouped in JS
    sb
      .from("payment_events")
      .select("reason")
      .in("event", ["grant_failed", "checkout_failed"])
      .gte("created_at", sinceIso),
    // recent feed (newest first)
    sb
      .from("payment_events")
      .select(
        "id, event, provider, user_id, tier, payment_id, checkout_session_id, reason, signature_valid, matched, amount_cents, currency, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    // whop inbound-delivery truth (every delivery, pre-verify)
    sb
      .from("webhook_attempts")
      .select("id, result, signature_valid, event_id, error, received_at")
      .eq("provider", "whop")
      .order("received_at", { ascending: false })
      .limit(DELIVERY_LIMIT),
  ]);

  // ── failure reasons ──
  const reasonCounts = new Map<string, number>();
  for (const r of (failureRowsRes.data ?? []) as Array<{ reason: string | null }>) {
    const key = r.reason ?? "(unspecified)";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const failureReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // ── webhook delivery truth (all-time for whop; small table) ──
  const recentDeliveries = (deliveriesRes.data ?? []) as WebhookDeliveryRow[];
  const byResult: Record<string, number> = {};
  for (const d of recentDeliveries) {
    byResult[d.result] = (byResult[d.result] ?? 0) + 1;
  }
  // Full all-time delivery count + sig_invalid count (not just the recent page).
  const [{ count: deliveryTotal }, { count: sigInvalidTotal }] = await Promise.all([
    sb
      .from("webhook_attempts")
      .select("id", { count: "exact", head: true })
      .eq("provider", "whop"),
    sb
      .from("webhook_attempts")
      .select("id", { count: "exact", head: true })
      .eq("provider", "whop")
      .eq("result", "sig_invalid"),
  ]);

  const totalDeliveries = deliveryTotal ?? 0;
  const sigInvalid = sigInvalidTotal ?? 0;
  const webhookUnmatched = webhookUnmatchedRes.count ?? 0;

  const funnel: FunnelStep[] = [
    { key: "checkout_session_created", label: "Checkout started", count: created },
    { key: "checkout_redirected", label: "Redirected to pay", count: redirected },
    { key: "webhook_received", label: "Webhook received", count: webhookReceived },
    { key: "grant_succeeded", label: "Pro granted", count: grantSucceeded },
  ];

  // ── headline diagnosis: 0-attempts vs broken-grant ──
  let diagnosis: string;
  if (sigInvalid > 0) {
    diagnosis =
      `ALARM: ${sigInvalid} Whop webhook deliver${sigInvalid === 1 ? "y" : "ies"} were REJECTED for an invalid signature — ` +
      `this is the WHOP_WEBHOOK_SECRET-mismatch signature: real payments would arrive and never grant. Fix the secret, then re-deliver from the Whop dashboard.`;
  } else if (grantFailed > 0 || webhookUnmatched > 0) {
    diagnosis =
      `${grantFailed} grant${grantFailed === 1 ? "" : "s"} failed and ${webhookUnmatched} webhook${webhookUnmatched === 1 ? "" : "s"} were unmatched in the last ${WINDOW_DAYS}d — ` +
      `a payment may have arrived without granting Pro. Check the failure reasons + the feed below for the payment id, then grant manually.`;
  } else if (created === 0 && totalDeliveries === 0) {
    diagnosis =
      `No checkout was started and no Whop webhook has ever been received. The "0 successful payments" is a 0-ATTEMPT story (a distribution problem), not a broken-payment story — instrumentation is live and will record the first real attempt.`;
  } else if (created > 0 && grantSucceeded === 0) {
    diagnosis =
      `${created} checkout${created === 1 ? "" : "s"} started but 0 grants — buyers reached Whop and did not complete payment (or the webhook never arrived: ${totalDeliveries} delivered). No silent grant failure detected.`;
  } else {
    diagnosis = `${grantSucceeded} successful grant${grantSucceeded === 1 ? "" : "s"} in the last ${WINDOW_DAYS}d. No failed grants or rejected webhooks detected.`;
  }

  return {
    generated_at: nowIso,
    window_days: WINDOW_DAYS,
    funnel,
    totals: {
      checkout_failed: checkoutFailed,
      grant_failed: grantFailed,
      grant_succeeded: grantSucceeded,
      webhook_received: webhookReceived,
      webhook_unmatched: webhookUnmatched,
    },
    failure_reasons: failureReasons,
    webhook_deliveries: {
      total: totalDeliveries,
      by_result: byResult,
      sig_invalid: sigInvalid,
      recent: recentDeliveries,
    },
    recent_events: (recentRes.data ?? []) as PaymentFeedRow[],
    diagnosis,
  };
}
