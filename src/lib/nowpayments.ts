/**
 * NOWPayments shared utilities.
 *
 * Used by:
 *   - src/app/api/checkout/nowpayments/route.ts   (create invoice)
 *   - src/app/api/webhooks/nowpayments/route.ts   (verify IPN + process)
 *   - scripts/test_nowpayments_signature.mjs      (signature unit test)
 *
 * Reference:
 *   https://nowpayments.io/help/what-is/what-is-ipn
 *   NOWPayments publishes a canonical Node example for the IPN
 *   signature scheme:
 *
 *     const hmac = crypto.createHmac('sha512', ipnSecret);
 *     hmac.update(JSON.stringify(params, Object.keys(params).sort()));
 *     const signature = hmac.digest('hex');
 *
 *   `JSON.stringify(params, Object.keys(params).sort())` sorts ONLY
 *   the top-level keys alphabetically and uses JSON.stringify's
 *   default separators (`,` and `:`) with no extra whitespace. That's
 *   what the production webhook verifier below implements. NOWPayments
 *   IPN payloads don't nest objects in the fields we care about
 *   (payment_id, payment_status, order_id, etc. are all primitives),
 *   so a non-recursive top-level sort is correct. If NOWPayments ever
 *   ships a webhook with a nested object, they'd have to update their
 *   own Node docs too — this matches their canonical reference.
 *
 * Amount tolerance: NOWPayments' `actually_paid` can come in slightly
 * under `pay_amount` due to network-fee variance. We accept anything
 * within 0.5% underpay as "finished"; larger shortfalls are flagged
 * as `partially_paid` for admin review (see normalisePaymentStatus).
 */

import crypto from "crypto";
import { CARD_TRIAL_DAYS } from "@/lib/card-trial";

// ── Tier catalogue (single source of truth) ──────────────────────
// Keep prices in cents so subscriptions.amount_cents is always an int.
//
// Tier ids map directly to:
//   - `subscriptions.tier` (DB column, free text)
//   - `TIERS[id].available` — gates the checkout route
//   - `referralPayoutCents(tier)` — tiered referral payouts (see below)
//   - `isPuypEligibleTier(tier)` — subscription-extension eligibility
//
// Current sprint (April 23 2026 locks):
//   - `premium_pass_guaranteed` is the €114 "June 26 Cohort" tier with
//     the Pass-Until-You-Pass guarantee. Live for crypto checkout.
//   - The four always-on tiers (monthly / three_month / six_month /
//     twelve_month) show on the pricing page but are waitlist-only
//     until Stripe Atlas clears.
//   - "Founders'" branding is retired across the product. `founders`
//     is not a valid tier id anymore.

export interface TierDefinition {
  id: string;
  priceCents: number;
  currency: "EUR";
  durationMonths: number;
  /** English copy used in NOWPayments invoice description / admin */
  humanName: string;
  /** German copy for the pricing page localisation */
  humanNameDe: string;
  /** Is this tier live for crypto checkout right now? */
  available: boolean;
  /** Qualifies for Pass-Until-You-Pass auto-extension */
  puypEligible: boolean;
  /** Referral payout (cents) when a referee activates this tier. Lock #3. */
  referralPayoutCents: number;
  /** Card trials only: free days before Whop's first charge (owner: src/lib/card-trial.ts). */
  trialDays?: number;
}

export const TIERS: Record<string, TierDefinition> = {
  // ── The cohort tier — live now, PUYP-guaranteed ──
  premium_pass_guaranteed: {
    id: "premium_pass_guaranteed",
    priceCents: 12900, // €129 — raised from €114 on 2026-06-25
    currency: "EUR",
    durationMonths: 6,
    humanName: "Exam Cohort (6 months, Pass-Until-You-Pass)",
    humanNameDe: "Prüfungs-Kohorte (6 Monate, Pass-Until-You-Pass)",
    available: false,
    puypEligible: true,
    referralPayoutCents: 7500, // €75 — lock #3 premium tier
  },
  // ── €49 / 3-month Starter — live on Whop rails (raised 2026-06-25 from €27) ──
  //
  // ~€16-effective-per-month, billed once as a €49 lump sum. ONE-TIME
  // INVOICE, NO AUTO-RENEWAL. Same payment-pattern as every other
  // NOWPayments tier — single invoice, no rebill.
  //
  // **Eligibility cap (anti-cannibalization):** each user can buy this
  // tier only ONCE. Enforced server-side in
  // `src/app/api/checkout/nowpayments/route.ts` by checking for any
  // existing `subscriptions` row with `tier='first_3mo_27'` AND
  // `started_at IS NOT NULL` (i.e. payment was confirmed). If yes →
  // return 400 + nudge user toward Cohort or the single-month tier.
  //
  // Rationale (Integrator audit 2026-04-28): without the 3-month cap,
  // users could park indefinitely on the entry tier. 3 months is enough
  // to taste the product and short enough to force a step-up decision.
  // After expiry the upgrade nudge is Cohort first; `first_month_19`
  // (€19) stays available as a "just one more month" bridging fallback.
  first_3mo_27: {
    id: "first_3mo_27",
    priceCents: 4900, // €49 (raised from €27 on 2026-06-25)
    currency: "EUR",
    durationMonths: 3,
    humanName: "3-month Starter (one-time, ~€9/month effective)",
    humanNameDe: "3-Monats-Einstieg (einmalig, ~9 € pro Monat)",
    available: false, // Retired customer checkout rail. Keep tier data for old entitlements/webhooks.
    puypEligible: false, // 90 days is too short for PUYP — that needs 6mo+
    // €49 net is ~€47 after Whop fees; €15 referral keeps margin
    // positive while still being attractive for Telegram/social sharing.
    // Value locked — referral economics remain sound at the new price.
    referralPayoutCents: 1500, // €15
  },
  // ── €19 / 1-month — the advertised entry tier (price unchanged 2026-06-25) ──
  //
  // The displayed entry price on all surfaces. Kept available as a
  // single bridging month for users whose 3-month Starter has expired
  // before they upgrade to the Cohort (€129). UI surfaces it as the
  // entry-level / "one more month" option.
  //
  // ONE-TIME INVOICE, NO AUTO-RENEWAL. On day 25 the
  // /api/cron/trial-reminder cron emails the user to pick a longer
  // tier; otherwise access simply lapses when expires_at passes.
  // Too short for PUYP — 30 days is not a prep window.
  first_month_19: {
    id: "first_month_19",
    priceCents: 1900, // €19
    currency: "EUR",
    durationMonths: 1,
    humanName: "Single month (one-time, no auto-renew)",
    humanNameDe: "Einzelmonat (einmalig, keine automatische Verlängerung)",
    available: false, // Retired customer checkout rail. Keep tier data for old entitlements/webhooks.
    puypEligible: false, // too short for PUYP
    // €19 net is ~€16 after NOWPayments fees; €25 referral was margin-
    // negative. Locked to €10 per [name]'s 2026-04-26 decision (review-
    // 2026-04-26-D2). Keeps the share rewarded but the math positive.
    referralPayoutCents: 1000, // €10
  },
  // ── Notes Pro trial — Whop card-on-file, €0 now → €19/mo after 7 days ──
  //
  // 2026-07-01. The Notes-feature conversion lever, moved onto a Whop RENEWAL
  // plan (plan_redactedec56d4df: trial_period_days=7, initial_price=0,
  // renewal_price=€19, billing_period=30d). The user links a working card at
  // signup (€0 charged now), gets 7 days of full Pro, and Whop auto-charges
  // €19/month afterwards unless they cancel in-trial. Each €19 charge fires
  // payment.succeeded → the whop webhook extends Pro by durationMonths (=1).
  // Distinct tier id (NOT first_month_19) so trial-sourced recurring revenue is
  // reportable separately from a one-time €19 buy. Gated live by
  // NOTES_TRIAL_ENABLED; plan id in env WHOP_PLAN_NOTES_TRIAL.
  notes_pro_trial: {
    id: "notes_pro_trial",
    priceCents: 1900, // €19 — the post-trial recurring price
    currency: "EUR",
    durationMonths: 1, // each renewal charge grants one month
    humanName: "Pro (7-day free trial, then €19/month)",
    humanNameDe: "Pro (7 Tage gratis, dann 19 €/Monat)",
    available: true,
    puypEligible: false, // recurring monthly — no pass-until-you-pass guarantee
    referralPayoutCents: 1000, // €10 — matches the €19 one-month economics
    trialDays: CARD_TRIAL_DAYS.notes_pro_trial,
  },
  // ── Phantom tiers — removed from all UI 2026-06-25; dead data pending deletion ──
  // Keys kept: string literals in waitlist/non-crypto-waitlist routes still reference them.
  monthly: {
    id: "monthly",
    priceCents: 2900, // €29
    currency: "EUR",
    durationMonths: 1,
    humanName: "Monthly",
    humanNameDe: "Monatlich",
    available: false,
    puypEligible: false,
    referralPayoutCents: 2500, // €25
  },
  three_month: {
    id: "three_month",
    priceCents: 7900, // €79
    currency: "EUR",
    durationMonths: 3,
    humanName: "3 months",
    humanNameDe: "3 Monate",
    available: false,
    puypEligible: false,
    referralPayoutCents: 2500, // €25
  },
  six_month: {
    id: "six_month",
    priceCents: 14900, // €149
    currency: "EUR",
    durationMonths: 6,
    humanName: "6 months",
    humanNameDe: "6 Monate",
    available: false,
    // PUYP applies to 6mo tier per [name]'s 2026-04-26 decision (review-
    // 2026-04-26-D1). Cohort + 6mo + 12mo all carry the guarantee;
    // €19, €29, €79 do NOT. Aligns code with content-truth.ts +
    // updated FAQ copy.
    puypEligible: true,
    referralPayoutCents: 5000, // €50
  },
  twelve_month: {
    id: "twelve_month",
    priceCents: 22900, // €229
    currency: "EUR",
    durationMonths: 12,
    humanName: "12 months (annual)",
    humanNameDe: "12 Monate (Jahresabo)",
    available: false,
    puypEligible: true, // annual_any qualifies per lock #1
    referralPayoutCents: 5000, // €50
  },
  // ── Offer v2 (a-pricing-v2): Whop card rails only, never crypto ──
  // `available:false` keeps them off the NOWPayments route; the Whop checkout
  // gates them on PRICING_V2_ENABLED (src/lib/pricing-v2/flag.ts). Mirrors
  // content-truth TIERS. durationMonths is the per-charge grant (the Sitting
  // Pass maximum; its exact end comes from src/lib/pricing-v2/sitting-pass.ts).
  flex_month: {
    id: "flex_month",
    priceCents: 2400,
    currency: "EUR",
    durationMonths: 1,
    humanName: "Monthly plan (24 EUR every 30 days)",
    humanNameDe: "Monatsabo (24 € alle 30 Tage)",
    available: false,
    puypEligible: false,
    referralPayoutCents: 0,
  },
  // ── 3-day card trial (a-card-trial-build-1024, decision whop-card-trial-1024) ──
  // Hidden Whop RENEWAL plan WHOP_PLAN_FLEX_TRIAL: trial_period_days 3,
  // initial 0, then 24 EUR every 30 days. Its own tier (never flex_month) so
  // a renewal, which carries no metadata, maps by plan id and a direct 24 EUR
  // buyer never gets free days. Checkout only through /api/whop/trial while
  // CARD_TRIAL_ENABLED is on; `available:false` keeps it off every other rail.
  flex_month_trial: {
    id: "flex_month_trial",
    priceCents: 2400, // the post-trial renewal price (v2 Monatsabo)
    currency: "EUR",
    durationMonths: 1, // each renewal charge grants one month
    humanName: "Monthly plan with 3-day trial, then 24 EUR every 30 days",
    humanNameDe: "Monatsabo mit 3 Tagen Pro-Test, dann 24 € alle 30 Tage",
    available: false,
    puypEligible: false,
    referralPayoutCents: 0,
    trialDays: CARD_TRIAL_DAYS.flex_month_trial,
  },
  sitting_pass: {
    id: "sitting_pass",
    priceCents: 5900,
    currency: "EUR",
    durationMonths: 3,
    humanName: "Sitting Pass (until your exam, at most 3 months)",
    humanNameDe: "Prüfungspass (bis zu Ihrem Termin, höchstens 3 Monate)",
    available: false,
    puypEligible: false,
    referralPayoutCents: 0,
  },
  half_year: {
    id: "half_year",
    priceCents: 10000,
    currency: "EUR",
    durationMonths: 6,
    humanName: "6 months (renews until your exam date has passed)",
    humanNameDe: "6 Monate (verlängert sich bis nach Ihrem Prüfungstermin)",
    available: false,
    puypEligible: false,
    referralPayoutCents: 0,
  },
  guarantee_ticket: {
    id: "guarantee_ticket",
    priceCents: 17900,
    currency: "EUR",
    durationMonths: 12,
    humanName: "Guarantee Ticket (12 months, Mentor included)",
    humanNameDe: "Garantie-Ticket (12 Monate, Mentor inklusive)",
    available: false,
    puypEligible: false,
    referralPayoutCents: 0,
  },
};

/**
 * Referral payout (in cents) for a given referee-activated tier.
 * Returns 0 for unknown tiers (defensive). Capped at €600/year by
 * the /api/referrals/* endpoints, not here.
 *
 * Lock #3 (April 23): tiered payouts replace the flat €40/€400 model.
 */
export function referralPayoutCents(tier: string | null | undefined): number {
  if (!tier) return 0;
  const def = TIERS[tier];
  return def ? def.referralPayoutCents : 0;
}

/**
 * Is this tier entitled to the Pass-Until-You-Pass subscription
 * extension on a failed-exam proof? (Lock #1 April 23.)
 */
export function isPuypEligibleTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  const def = TIERS[tier];
  return def ? def.puypEligible : false;
}

/** Annual cap for referrer payouts, in cents. Lock #3. */
export const REFERRAL_ANNUAL_CAP_CENTS = 60000; // €600

// ── Signature verification ────────────────────────────────────────

/**
 * Compute the NOWPayments IPN signature for a given payload + secret.
 *
 * Matches NOWPayments' canonical Node example exactly:
 *   hmac.update(JSON.stringify(params, Object.keys(params).sort()))
 *
 * Exported separately from `verifyNowpaymentsSignature` so the unit
 * test can sign arbitrary payloads without first signing an env
 * secret.
 */
export function computeNowpaymentsSignature(
  payload: Record<string, unknown>,
  secret: string
): string {
  const sortedKeys = Object.keys(payload).sort();
  const serialised = JSON.stringify(payload, sortedKeys);
  return crypto.createHmac("sha512", secret).update(serialised).digest("hex");
}

/**
 * Verify a NOWPayments IPN request. Returns true only if both the
 * header and secret are present AND the signature matches.
 *
 * Uses timingSafeEqual on Buffers to avoid leaking info through
 * string-compare timing. The two signatures are always the same
 * length (128 hex chars for SHA-512), so timingSafeEqual is safe.
 *
 * Callers should treat a `false` return as an attacker request and
 * respond with 401 (NOT 400 — we don't want to help an attacker
 * tune their payload).
 */
export function verifyNowpaymentsSignature(
  payload: Record<string, unknown>,
  headerSignature: string | null | undefined,
  secret: string
): boolean {
  if (!headerSignature || !secret) return false;

  const expected = computeNowpaymentsSignature(payload, secret);

  // timingSafeEqual requires equal-length buffers. SHA-512 hex is
  // always 128 chars, but we're defensive in case a malformed header
  // arrives (some proxies trim trailing whitespace etc).
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(headerSignature, "hex");

  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── NOWPayments API calls ─────────────────────────────────────────

export interface InvoicePayload {
  priceAmount: number; // in price_currency units (not cents!)
  priceCurrency: string; // 'EUR'
  orderId: string; // our subscription.id
  orderDescription: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Force the user to pay in the specified crypto. Defaults to
   * `'usdttrc20'` (Tether on Tron — fastest + cheapest network).
   * Pass `null` to let the user pick on the NOWPayments invoice page,
   * but DON'T do this in production: a stable single-currency flow
   * lets us pre-state the pay amount in the trust dialog and gives
   * us a deterministic webhook + reconciliation path.
   */
  payCurrency?: string | null;
  /**
   * Lock the EUR↔crypto exchange rate at invoice creation time so the
   * user sees the same number on our trust dialog and on the
   * NOWPayments page (instead of seeing a "rate may change" disclaimer
   * that erodes trust). Default true.
   */
  isFixedRate?: boolean;
}

export interface InvoiceResponse {
  id: number | string;
  invoice_url: string;
  order_id: string;
  order_description: string;
  price_amount: number;
  price_currency: string;
  pay_currency: string | null;
  ipn_callback_url: string;
  success_url: string;
  cancel_url: string;
  created_at: string;
  updated_at: string;
}

/**
 * Create a NOWPayments invoice. Returns the parsed response on
 * success, or throws on HTTP error / missing API key.
 *
 * No retries — the caller (API route) should handle failures. If
 * NOWPayments is down when a user clicks "pay", the UX is a short
 * error toast, not a half-created subscription row.
 */
export async function createNowpaymentsInvoice(
  input: InvoicePayload,
  apiKey: string
): Promise<InvoiceResponse> {
  if (!apiKey) {
    throw new Error("NOWPAYMENTS_API_KEY is not set");
  }

  // Default pay_currency = USDT-TRC20 (Tether on Tron) — fastest +
  // cheapest network, ~1 USD fee, ~30s confirm. Stable 1:1 to USD so
  // the pre-checkout trust dialog can quote the exact amount the user
  // will see on NOWPayments.
  //
  // is_fixed_rate=true locks the EUR→USDT rate at invoice creation
  // so the user doesn't see a "rate may change" disclaimer mid-flow.
  const payCurrency =
    input.payCurrency === null
      ? null
      : (input.payCurrency || "usdttrc20");

  const body: Record<string, unknown> = {
    price_amount: input.priceAmount,
    price_currency: input.priceCurrency,
    order_id: input.orderId,
    order_description: input.orderDescription,
    ipn_callback_url: input.ipnCallbackUrl,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    is_fixed_rate: input.isFixedRate !== false,
  };
  if (payCurrency) body.pay_currency = payCurrency;

  const res = await fetch("https://api.nowpayments.io/v1/invoice", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `NOWPayments invoice creation failed: HTTP ${res.status} — ${text.slice(0, 500)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `NOWPayments returned non-JSON: ${text.slice(0, 200)}`
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).invoice_url !== "string"
  ) {
    throw new Error(
      `NOWPayments response missing invoice_url: ${JSON.stringify(parsed).slice(0, 200)}`
    );
  }

  return parsed as InvoiceResponse;
}

// ── Payment-status normalisation ──────────────────────────────────

/**
 * The full set of NOWPayments payment_status values. Kept exported
 * so the webhook can narrow on the correct union.
 */
export type NowpaymentsPaymentStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

/**
 * Map NOWPayments status → our subscriptions.status + whether to
 * activate the subscription.
 *
 * Amount tolerance: if NOWPayments reports `partially_paid` with
 * actually_paid within 0.5% of pay_amount, we still activate. A
 * bigger shortfall keeps the subscription in `partially_paid` state
 * so admin can decide (issue a top-up invoice vs refund).
 */
export interface StatusDecision {
  nextStatus:
    | "active"
    | "pending"
    | "expired"
    | "failed"
    | "refunded"
    | "partially_paid";
  activate: boolean;
  description: string;
}

export function normalisePaymentStatus(
  status: NowpaymentsPaymentStatus | string,
  payAmount?: number | null,
  actuallyPaid?: number | null
): StatusDecision {
  switch (status) {
    case "finished":
    case "confirmed":
      return {
        nextStatus: "active",
        activate: true,
        description: "Payment confirmed on-chain and credited.",
      };

    case "partially_paid": {
      // Apply the 0.5% tolerance rule. If we don't have numbers to
      // compare, treat as partial → admin review.
      if (
        typeof payAmount === "number" &&
        typeof actuallyPaid === "number" &&
        payAmount > 0 &&
        actuallyPaid / payAmount >= 0.995
      ) {
        return {
          nextStatus: "active",
          activate: true,
          description:
            "Payment accepted — underpay within 0.5% network-fee tolerance.",
        };
      }
      return {
        nextStatus: "partially_paid",
        activate: false,
        description:
          "Payment underpaid beyond 0.5% tolerance — flagged for admin review.",
      };
    }

    case "failed":
      return {
        nextStatus: "failed",
        activate: false,
        description: "Payment failed.",
      };

    case "expired":
      return {
        nextStatus: "expired",
        activate: false,
        description: "Invoice expired before payment was received.",
      };

    case "refunded":
      return {
        nextStatus: "refunded",
        activate: false,
        description: "Payment refunded.",
      };

    case "waiting":
    case "confirming":
    case "sending":
    default:
      // Intermediate states — log but don't change DB status.
      return {
        nextStatus: "pending",
        activate: false,
        description: `Intermediate state: ${status}`,
      };
  }
}

// ── Small helpers ─────────────────────────────────────────────────

/**
 * Compute the subscription expiry (UTC) for a tier's duration.
 */
export function computeExpiry(durationMonths: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + durationMonths);
  return d;
}

/**
 * Convert a NOWPayments pay_currency string ("usdttrc20") to the
 * display form we store in subscriptions.crypto_currency
 * ("USDT_TRC20"). Returns null for empty input.
 */
export function formatCryptoCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    usdttrc20: "USDT_TRC20",
    usdterc20: "USDT_ERC20",
    usdcerc20: "USDC_ERC20",
    usdcmatic: "USDC_POLYGON",
    btc: "BTC",
    eth: "ETH",
  };
  const key = raw.toLowerCase();
  return map[key] ?? raw.toUpperCase();
}
