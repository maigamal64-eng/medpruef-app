/**
 * paymentEvents — structured, append-only logger for the PAYMENT FUNNEL
 * (Gate 1, 2026-06-24). One call per funnel step writes one row to the
 * `payment_events` table so we can PROVE whether a user factually tried to
 * pay and exactly where the flow dropped.
 *
 * THE BUG THIS CLOSES (advisor 2026-06-24): supabase-js `.insert()` does NOT
 * throw on a constraint violation — it RETURNS `{ error }`. The webhook's
 * existing `recordEvent` writes to `user_events` (user_id uuid NOT NULL) with
 * `user_id: null` for unmapped events; that insert fails and the `{error}`
 * return is simply never read, so the row is DROPPED silently. A bare
 * try/catch reproduces the bug. So this logger:
 *   1. destructures + CHECKS the `error` return and console.error's it, and
 *   2. is best-effort (never throws / never blocks a grant or a checkout), and
 *   3. writes to `payment_events`, whose user_id is NULLABLE — an unmatched /
 *      failed grant is RECORDED (loud, visible in /admin/payments), not lost.
 *
 * PII: never store a raw email. user_id (when known) is the join key; a
 * one-way `email_hash` (sha256(email + PAYMENT_EVENTS_SALT), 32 hex chars,
 * mirror of csp_violations.ip_hash) lets the admin correlate an unmatched
 * webhook to a signup without persisting PII. payment_id / session_id /
 * plan_id / tier are operational identifiers, not PII. Server-side
 * operational logging is consent-independent.
 *
 * Reader: src/lib/admin/paymentFunnelMetrics.ts (+ /api/stats/admin/payments).
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The funnel steps. Kept loose (a string union, validated here, NOT a DB CHECK
 * constraint) so a new step can be added without a migration — same governance
 * choice as webhook_attempts.result.
 *
 *   checkout_session_created — plan clicked + Whop checkout session created
 *   checkout_redirected      — checkout route about to return purchase_url
 *                              (server-visible proxy for "redirected to pay")
 *   checkout_failed          — checkout route could not create a session
 *   webhook_received         — mirror row for EVERY inbound Whop webhook
 *   grant_succeeded          — Pro granted on payment.succeeded
 *   grant_failed             — money signal arrived but grant did NOT happen
 */
export type PaymentFunnelEvent =
  | "checkout_session_created"
  | "checkout_redirected"
  | "checkout_failed"
  | "webhook_received"
  | "grant_succeeded"
  | "grant_failed";

/**
 * Machine-readable reasons a grant or checkout dropped — surfaced verbatim in
 * the admin feed so a silent failure has a named cause.
 */
export type PaymentFailureReason =
  // checkout_failed
  | "unknown_tier"
  | "plan_not_configured"
  | "provider_error"
  // grant_failed
  | "signature_invalid"
  | "no_payment_id"
  | "unmapped" // no user OR no tier resolvable from the payload
  | "db_error"
  | "unrecognized_event"
  | "duplicate";

export interface PaymentEventInput {
  event: PaymentFunnelEvent;
  provider?: string; // defaults to 'whop'
  userId?: string | null;
  /** Raw email — hashed here, NEVER stored raw. */
  email?: string | null;
  tier?: string | null;
  checkoutSessionId?: string | null;
  planId?: string | null;
  paymentId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  reason?: PaymentFailureReason | null;
  /** webhook signature outcome; null/undefined for non-webhook steps. */
  signatureValid?: boolean | null;
  /** webhook_received: did we map it to a user/known sub? */
  matched?: boolean | null;
  /** Structured context — NEVER secrets/PII (event name, ok flag, status…). */
  metadata?: Record<string, unknown>;
}

const SALT = process.env.PAYMENT_EVENTS_SALT ?? "dev-local-payment-salt";

/** One-way email hash (32 hex chars) — mirror of csp_violations.ip_hash. */
export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  try {
    return crypto
      .createHash("sha256")
      .update(email.trim().toLowerCase() + SALT)
      .digest("hex")
      .slice(0, 32);
  } catch {
    return null;
  }
}

/**
 * Insert one payment-funnel row. NEVER throws — instrumentation must never
 * break the checkout or the grant. On a failed insert it console.error's the
 * `{error}` return (the exact thing the old recordEvent failed to do) so a
 * sustained logging breakage is visible in the Vercel runtime logs.
 *
 * Pass the caller's existing service client so we don't spin a new one per
 * event (the webhook/checkout already hold one).
 */
export async function logPaymentEvent(
  sb: SupabaseClient,
  input: PaymentEventInput
): Promise<void> {
  try {
    const row = {
      event: input.event,
      provider: input.provider ?? "whop",
      user_id: input.userId ?? null,
      email_hash: hashEmail(input.email),
      tier: input.tier ?? null,
      checkout_session_id: input.checkoutSessionId ?? null,
      plan_id: input.planId ?? null,
      payment_id: input.paymentId ?? null,
      amount_cents: input.amountCents ?? null,
      currency: input.currency ?? null,
      reason: input.reason ?? null,
      signature_valid:
        input.signatureValid === undefined ? null : input.signatureValid,
      matched: input.matched === undefined ? null : input.matched,
      metadata: input.metadata ?? {},
    };

    const { error } = await sb.from("payment_events").insert(row);
    if (error) {
      // The bug we are closing: read + surface the error return. Best-effort —
      // we do NOT propagate it, so the grant/checkout still completes.
      console.error("[paymentEvents] insert failed", {
        event: input.event,
        code: (error as { code?: string }).code,
        message: error.message?.slice(0, 200),
      });
    }
  } catch (err) {
    console.error("[paymentEvents] unexpected error", {
      event: input.event,
      err,
    });
  }
}
