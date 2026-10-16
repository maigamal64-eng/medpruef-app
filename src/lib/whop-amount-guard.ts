/**
 * Pro grant amount guard (a-whop-grant-amount-guard, Whop review 16 Oct, gap G2).
 *
 * A Pro payment grants only when it was charged in EUR and paid at least
 * MIN_PAID_RATIO (80 percent) of the tier's TIERS price, the same rule the
 * mentor credit path applies (src/lib/mentor/credits/grant-payment.ts). A
 * 100 percent promo code (EUR 0 on a paid tier), an adaptive-pricing charge in
 * another currency or a wrong plan price is held for a manual grant instead
 * of granting the full window. The paid amount is `chargedAmountCents`
 * (gross first), not the mentor helper's lowest field.
 *
 * Exempt: the EUR 0 START of the card trial (notes_pro_trial with an explicit
 * zero), which the webhook grants as its 8-day window. Its later EUR 19
 * renewals are checked like any other charge.
 *
 * Mode WHOP_AMOUNT_GUARD (server env):
 *   - "off":     no check, today's behaviour exactly.
 *   - "shadow":  (default) check, record and alert, then grant as today.
 *   - "enforce": check, record and alert, and HOLD: nothing is granted, the
 *                payment stays in Admin > Payments > Unresolved for a manual
 *                link (POST /api/admin/payments/resolve).
 * Anything else reads as the default.
 *
 * Alert: one per payment across every path (webhook, checkout verify and its
 * polling) through a claim in processed_webhook_events (provider
 * AMOUNT_HOLD_CLAIM_PROVIDER, excluded from the deliveries list). The first
 * sighting writes the `whop_payment_amount_mismatch` user_events row (paged by
 * /api/cron/checkout-failure-watch and read by the Mac-side
 * scripts/whop/amount-hold-notify.py, which sends it through notify.py)
 * and one Sentry message. A failed row write frees the claim so the next
 * sighting alerts again.
 */

import { whopMoneyMajor } from "@/lib/whop-api";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TIERS } from "@/lib/whop";
import { amountProblem, MIN_PAID_RATIO } from "@/lib/mentor/credits/grant-payment";
import { PENDING_REVOKE_USER } from "@/lib/whop-pending-revoke";

export type AmountGuardMode = "off" | "shadow" | "enforce";
export const AMOUNT_GUARD_DEFAULT: AmountGuardMode = "shadow";
export const AMOUNT_MISMATCH_EVENT = "whop_payment_amount_mismatch";
export const AMOUNT_HOLD_CLAIM_PROVIDER = "whop_amount_hold";

export function amountGuardMode(env: Record<string, string | undefined> = process.env): AmountGuardMode {
  const raw = (env.WHOP_AMOUNT_GUARD ?? "").trim().toLowerCase();
  return raw === "off" || raw === "shadow" || raw === "enforce" ? raw : AMOUNT_GUARD_DEFAULT;
}

export type AmountCause = "no_amount" | "zero_amount" | "currency" | "under_price" | "tier_not_priced";

// release-int-8 seam (a-whop-pin-hotfix): read a number, a numeric string or
// a Whop money object, so an unpinned payload never reads as "no amount".
function num(v: unknown): number | null {
  return whopMoneyMajor(v);
}

/**
 * What the buyer was charged, in cents, for the Pro check (reviewer P2):
 * the first GROSS field Whop reports (final_amount, total, amount, subtotal),
 * so a coupon (final_amount) counts while a net figure after fees or VAT never
 * makes a full charge look short; amount_after_fees only when no gross field
 * exists (the v1 payload may carry only that; 17.72 of 19 still passes).
 * null when no amount field is present.
 */
export function chargedAmountCents(payment: unknown): number | null {
  const d = payment && typeof payment === "object" ? (payment as Record<string, unknown>) : {};
  const keys = ["final_amount", "total", "amount", "subtotal", "amount_after_fees"];
  // Any field at exactly 0 is a free charge (a 100 percent coupon may show only
  // in the net figure while amount or subtotal keep the list price).
  if (keys.some((k) => num(d[k]) === 0)) return 0;
  for (const k of keys) {
    const n = num(d[k]);
    if (n !== null) return Math.round(n * 100);
  }
  return null;
}

export interface AmountCheckInput {
  tier: string;
  /** What the buyer paid in cents (lowest Whop amount field), null when unreadable. */
  paidCents: number | null;
  /** ISO currency as Whop reported it; null or empty = not reported (tolerated, the plan pins EUR). */
  currency: string | null;
  /** The EUR 0 start of the card trial: never checked. */
  trialStart?: boolean;
}

export type AmountCheck =
  | { ok: true }
  | { ok: false; cause: AmountCause; priceCents: number | null; minCents: number | null };

/** Pure rule: may this Pro payment grant its tier? */
export function checkProPaymentAmount(input: AmountCheckInput): AmountCheck {
  if (input.trialStart) return { ok: true };
  const price = TIERS[input.tier]?.priceCents ?? null;
  const currency = input.currency && input.currency.trim() !== "" ? input.currency.trim() : null;
  const problem = amountProblem(input.paidCents, currency, price);
  if (!problem) return { ok: true };
  const minCents = price != null && price > 0 ? Math.floor(price * MIN_PAID_RATIO) : null;
  let cause: AmountCause;
  if (problem === "package_not_priced") cause = "tier_not_priced";
  else if (input.paidCents == null) cause = "no_amount";
  else if (!(input.paidCents > 0)) cause = "zero_amount";
  else if (currency && currency.toLowerCase() !== "eur") cause = "currency";
  else cause = "under_price";
  return { ok: false, cause, priceCents: price, minCents };
}

export type AmountGuardDecision =
  | { action: "grant"; mismatch: null }
  | { action: "grant"; mismatch: Extract<AmountCheck, { ok: false }> } // shadow
  | { action: "hold"; mismatch: Extract<AmountCheck, { ok: false }> };

export function decideAmountGuard(input: AmountCheckInput, mode: AmountGuardMode = amountGuardMode()): AmountGuardDecision {
  if (mode === "off") return { action: "grant", mismatch: null };
  const check = checkProPaymentAmount(input);
  if (check.ok) return { action: "grant", mismatch: null };
  return mode === "enforce" ? { action: "hold", mismatch: check } : { action: "grant", mismatch: check };
}

type Db = Pick<SupabaseClient, "from">;

export interface AmountAlertInput {
  paymentId: string;
  userId: string | null;
  tier: string;
  planId: string | null;
  paidCents: number | null;
  currency: string | null;
  mismatch: Extract<AmountCheck, { ok: false }>;
  /** Which path saw it: webhook, checkout_verify, checkout_verify_fallback. */
  source: string;
  /** true = the grant was held (enforce), false = granted anyway (shadow). */
  held: boolean;
}

/**
 * Record and alert once per payment. Never throws. Returns whether this call
 * raised the alert (false = an earlier sighting already did, or the claim
 * could not be read, in which case Sentry still hears about it).
 */
export async function alertAmountMismatch(sb: Db, a: AmountAlertInput): Promise<{ alerted: boolean }> {
  const summary = `Whop payment ${a.paymentId} ${a.held ? "HELD" : "granted (shadow)"}: ${a.mismatch.cause} ` +
    `(paid ${a.paidCents ?? "unknown"} ${a.currency ?? "currency unknown"}, ${a.tier} price ${a.mismatch.priceCents ?? "unknown"} EUR cents, ` +
    `minimum ${a.mismatch.minCents ?? "n/a"}) user=${a.userId ?? "unmapped"} via ${a.source}`;
  try {
    const { data: claim, error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({ provider: AMOUNT_HOLD_CLAIM_PROVIDER, event_id: a.paymentId, payload: { claimed_at: new Date().toISOString(), source: a.source } })
      .select("event_id")
      .maybeSingle();
    if (claimErr) {
      if ((claimErr as { code?: string }).code === "23505") return { alerted: false };
      Sentry.captureMessage(`${summary}; alert claim failed: ${String(claimErr.message ?? "").slice(0, 120)}`, a.held ? "error" : "warning");
      return { alerted: false };
    }
    if (!claim) return { alerted: false };
    const { error: rowErr } = await sb.from("user_events").insert({
      user_id: PENDING_REVOKE_USER,
      event_type: AMOUNT_MISMATCH_EVENT,
      event_data: {
        payment_id: a.paymentId,
        user_id: a.userId,
        tier: a.tier,
        plan_id: a.planId,
        paid_cents: a.paidCents,
        currency: a.currency ? a.currency.toUpperCase() : null,
        price_cents: a.mismatch.priceCents,
        min_cents: a.mismatch.minCents,
        cause: a.mismatch.cause,
        source: a.source,
        held: a.held,
        mode: a.held ? "enforce" : "shadow",
      },
    });
    if (rowErr) {
      // Free the claim so the next sighting (redelivery, the success page) alerts again.
      const { error: freeErr } = await sb.from("processed_webhook_events").delete().eq("provider", AMOUNT_HOLD_CLAIM_PROVIDER).eq("event_id", a.paymentId);
      Sentry.captureMessage(
        `${summary}; alert row not written: ${String(rowErr.message ?? "").slice(0, 120)}${freeErr ? "; alert claim stuck, later sightings stay silent" : ""}`,
        a.held ? "error" : "warning",
      );
      return { alerted: false };
    }
    Sentry.captureMessage(summary, { level: a.held ? "error" : "warning", tags: { route: "whop-amount-guard", cause: a.mismatch.cause, source: a.source } });
    return { alerted: true };
  } catch (err) {
    Sentry.captureMessage(`${summary}; alert threw: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`, a.held ? "error" : "warning");
    return { alerted: false };
  }
}
