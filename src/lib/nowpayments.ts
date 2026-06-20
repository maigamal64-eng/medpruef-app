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
}

export const TIERS: Record<string, TierDefinition> = {
  // ── The cohort tier — live now, PUYP-guaranteed ──
  premium_pass_guaranteed: {
    id: "premium_pass_guaranteed",
    priceCents: 11400, // €114
    currency: "EUR",
    durationMonths: 6,
    humanName: "Kenntnisprüfung Cohort (6 months, Pass-Until-You-Pass)",
    humanNameDe: "Kenntnisprüfung-Kohorte (6 Monate, Pass-Until-You-Pass)",
    available: true,
    puypEligible: true,
    referralPayoutCents: 7500, // €75 — lock #3 premium tier
  },
  // ── €27 / 3-month entry tier — live on crypto rails (April 28 2026) ──
  //
  // €9-effective-per-month, billed once as a €27 lump sum. ONE-TIME
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
  // a €9-effective monthly anchor would let users park indefinitely
  // and erode the €114 Cohort tier (€9×12 = €108 ≈ €114). 3 months of
  // entry pricing is enough to taste the product and short enough to
  // force a step-up decision. After expiry the upgrade nudge is Cohort
  // first; `first_month_19` (€19) stays available as a "just one more
  // month" bridging fallback.
  first_3mo_27: {
    id: "first_3mo_27",
    priceCents: 2700, // €27
    currency: "EUR",
    durationMonths: 3,
    humanName: "3-month Starter (one-time, ~€9/month effective)",
    humanNameDe: "3-Monats-Einstieg (einmalig, ~9 € pro Monat)",
    available: true, // LIVE for crypto checkout
    puypEligible: false, // 90 days is too short for PUYP — that needs 6mo+
    // €27 net is ~€26 after NOWPayments fees; €15 referral keeps margin
    // positive (~€11 contribution per referred user) while being
    // attractive enough for Telegram/social sharing per the 2026-04-28
    // referral-emphasis brief.
    referralPayoutCents: 1500, // €15
  },
  // ── €19 first-month — fallback tier, demoted on UI 2026-04-28 ──
  //
  // Was the primary entry tier from April 24 to April 28. Demoted to
  // a fallback after the €27/3-month entry shipped — kept available
  // so users whose 3-month entry expired can buy a single bridging
  // month before upgrading to Cohort. UI no longer surfaces it as
  // the default entry; it's a small "or just one more month?" link
  // under the starter card and on post-expiry upsell screens.
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
    available: true, // LIVE for crypto checkout (fallback)
    puypEligible: false, // too short for PUYP
    // €19 net is ~€16 after NOWPayments fees; €25 referral was margin-
    // negative. Locked to €10 per [name]'s 2026-04-26 decision (review-
    // 2026-04-26-D2). Keeps the share rewarded but the math positive.
    referralPayoutCents: 1000, // €10
  },
  // ── Four always-on tiers — waitlist until Stripe Atlas ──
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
