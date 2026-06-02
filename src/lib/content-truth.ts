/**
 * src/lib/content-truth.ts
 *
 * Single source of truth for product copy + numbers — generated 2026-04-25.
 *
 * Every surface that quotes a number, tier price, payout, or claim
 * MUST import from here. Drift = bug.
 *
 * This file is intentionally framework-agnostic (no React, no
 * Next.js imports) so it can be consumed from server routes, edge
 * functions, email templates, OG image generators, and tests alike.
 *
 * Source documents: `context/COPY-BUNDLE-2026-04-24.md` is the
 * canonical pre-approved copy bundle. `src/lib/nowpayments.ts` is
 * the authoritative tier ledger for pricing math, and the values
 * below cross-check against it. If you change anything here, also
 * update `nowpayments.ts` (or vice versa) and walk the
 * sale-funnel surfaces in `src/app/(landing|pricing|faq|...)`.
 *
 * ── Voice guardrails (apply when consuming these constants) ────────
 *   - Never say: "nicht verfügbar", "Soft Launch", "limited time",
 *     "only X left" (unless literally true), "€25-75 pro Anmeldung"
 *     on first-touch surfaces, "Founders'", "game-changer",
 *     "revolutionary", "secret", "hack".
 *   - Currency format: "X €" (number + space + €). Never "€X",
 *     "EUR X", "X EUR", "X€".
 *   - `du` everywhere except `/privacy`, `/terms`, `/impressum`.
 *   - Zero exclamation marks on product surfaces.
 */

// ── 1. Question counts ─────────────────────────────────────────────
//
// This is a STATIC CACHE of a DB-owned fact. The authoritative count is
// `select count(*) from questions where is_active` (verified 10992 live
// on 2026-06-02). Every user-facing surface reads `QUESTIONS.total` from
// here so the number can never drift again — update this one constant
// after a content import, not the surfaces.
// SOT-REF: medpruef_question_count@DB:medpruef.questions
//
// Post-correction baseline (2026-04-24). Was "10,993" through Apr 23;
// the off-by-one came from a soft-deleted row that survived a partial
// archive. Wien dropped 7,567 → 7,566 in the same sweep. KMP and
// Pharma counts are unchanged.

export const QUESTIONS = {
  total: 10992,
  by_exam_type: {
    kenntnispruefung: 7566,
    kmp_innsbruck: 3091,
    pharma: 335,
  },
} as const;

// ── 2. Tier definitions ────────────────────────────────────────────
//
// Cross-check against `src/lib/nowpayments.ts`. The `id` field
// matches the NOWPayments tier id. The `available` flag mirrors
// `nowpayments.ts` — only `premium_pass_guaranteed` and
// `first_month_19` are live on crypto rails until Stripe Atlas
// clears.

type Tier = {
  readonly id: string;
  readonly price_cents: number;
  readonly duration_months: number;
  readonly puyp_eligible: boolean;
  readonly available: boolean;
  readonly name: { readonly de: string; readonly en: string };
  readonly referral_payout_cents: number;
};

export const TIERS = {
  free: {
    id: "free",
    price_cents: 0,
    duration_months: 0, // unbounded — 150 questions per exam, no expiry
    puyp_eligible: false,
    available: true,
    name: { de: "Kostenlos", en: "Free" },
    referral_payout_cents: 0,
  },
  // ── €27 / 3-month entry tier — primary entry as of 2026-04-28 ──
  // €9-effective per month, billed once. Cap: each user can buy this
  // ONCE — eligibility enforced server-side in /api/checkout/nowpayments
  // by checking whether the user already has a `first_3mo_27` row with
  // started_at IS NOT NULL. This prevents indefinite parking on the
  // entry tier, which would cannibalize Cohort sales (Integrator audit
  // 2026-04-28). After expiry the upgrade path is Cohort €114 first;
  // `first_month_19` stays live as a "just one more month" fallback.
  first_3mo_27: {
    id: "first_3mo_27",
    price_cents: 2700, // €27 lump sum (= €9/month effective)
    duration_months: 3,
    puyp_eligible: false, // 90 days is short of a real prep arc; PUYP starts at 6mo
    available: true,
    name: { de: "3-Monats-Einstieg", en: "3-Month Starter" },
    // Referral payout sized to encourage Telegram/social sharing while
    // keeping margin positive after NOWPayments fees (€27 net ≈ €26 →
    // €15 referral leaves ~€11 contribution).
    referral_payout_cents: 1500, // €15
  },
  first_month_19: {
    id: "first_month_19",
    price_cents: 1900,
    duration_months: 1,
    puyp_eligible: false, // 30 days is too short for PUYP
    // Demoted to fallback as of 2026-04-28 — primary entry is now
    // `first_3mo_27`. Stays available so users whose 3-month entry
    // expired can buy a single bridging month before upgrading.
    available: true,
    name: { de: "Einzelmonat", en: "Single Month" },
    referral_payout_cents: 1000, // €10 per COPY-BUNDLE §4
  },
  monthly: {
    id: "monthly",
    price_cents: 2900,
    duration_months: 1,
    puyp_eligible: false,
    available: false, // waitlist until Stripe Atlas
    name: { de: "Monatlich", en: "Monthly" },
    referral_payout_cents: 2500, // €25 per COPY-BUNDLE §4
  },
  three_month: {
    id: "three_month",
    price_cents: 7900,
    duration_months: 3,
    puyp_eligible: false,
    available: false,
    name: { de: "3 Monate", en: "3 Months" },
    referral_payout_cents: 2500, // €25 per COPY-BUNDLE §4
  },
  six_month: {
    id: "six_month",
    price_cents: 14900,
    duration_months: 6,
    puyp_eligible: true,
    available: false,
    name: { de: "6 Monate", en: "6 Months" },
    referral_payout_cents: 5000, // €50 per COPY-BUNDLE §4
  },
  twelve_month: {
    id: "twelve_month",
    price_cents: 22900,
    duration_months: 12,
    puyp_eligible: true,
    available: false,
    name: { de: "12 Monate", en: "12 Months" },
    referral_payout_cents: 5000, // €50 per COPY-BUNDLE §4
  },
  premium_pass_guaranteed: {
    id: "premium_pass_guaranteed",
    price_cents: 11400,
    duration_months: 6,
    puyp_eligible: true,
    available: true,
    name: { de: "Juni-26-Kohorte", en: "June 26 Cohort" },
    referral_payout_cents: 7500, // €75 per COPY-BUNDLE §4
  },
} as const satisfies Record<string, Tier>;

export type TierId = keyof typeof TIERS;

/** Lookup by tier id — type-safe, returns `undefined` for unknown ids. */
export const TIER_BY_ID = TIERS as Readonly<Record<string, Tier | undefined>>;

// ── 3. Referral payouts ────────────────────────────────────────────
//
// Mirror of TIERS[…].referral_payout_cents — kept here as a flat map
// for surfaces that don't want to walk the tier ledger (the referrals
// page payout table, marketing emails, share-floater copy).
// The annual cap is enforced server-side in `/api/webhooks/nowpayments`.

export const REFERRAL_PAYOUTS = {
  first_3mo_27: 1500, // €15 — primary entry tier, sized for social/Telegram sharing
  first_month_19: 1000, // €10
  monthly: 2500, // €25
  three_month: 2500, // €25
  six_month: 5000, // €50
  twelve_month: 5000, // €50
  premium_pass_guaranteed: 7500, // €75
  annual_cap_cents: 60000, // €600/year per referrer
  hold_days: 30, // post-payment hold before payout becomes claimable
} as const;

// ── 4. Free-tier limits ────────────────────────────────────────────

export const FREE_TIER = {
  // 150 questions per exam type — never "150 total" or "450".
  // Total across all three exam types is 450, but the gate is
  // per-exam-type (a user can hit 150/150 on Kenntnisprüfung while
  // having 0/150 on Pharma).
  questions_per_exam_type: 150,
  exam_types_count: 3,
  total_questions_across_exams: 450,
  expires: false, // no expiry; user works through at their own pace
} as const;

// ── 5. Refund policy ───────────────────────────────────────────────

export const REFUND = {
  window_days: 7,
  email: "user-b7e46e80@example.com",
  // German + English canonical phrasing (per COPY-BUNDLE §2 guarantees_block).
  copy: {
    de: "7-Tage-Geld-zurück-Garantie. Keine Fragen, volle Rückerstattung. Schreib einfach an user-b7e46e80@example.com.",
    en: "7-day money-back guarantee. No questions asked, full refund. Just email user-b7e46e80@example.com.",
  },
} as const;

// ── 6. Pass-Until-You-Pass (PUYP) ──────────────────────────────────
//
// Eligible tiers per COPY-BUNDLE: 6mo + 12mo + cohort + premium-
// pass-guaranteed. NEVER on €19 or €29 or 3mo. The TIERS ledger
// above already encodes this; the array is here for places that need
// a flat allow-list (tier-feature comparison tables, FAQ logic).

export const PUYP_ELIGIBLE_TIERS: ReadonlyArray<TierId> = [
  "six_month",
  "twelve_month",
  "premium_pass_guaranteed",
];

export const PUYP = {
  eligible_tiers: PUYP_ELIGIBLE_TIERS,
  min_questions_completed_pct: 70,
  max_additional_cycles: 2,
  result_review_window_hours: 72,
} as const;

// ── 7. Company / legal entity ──────────────────────────────────────
//
// Per COPY-BUNDLE §7 footer line. Used on impressum, footer,
// pre-checkout trust dialog, post-purchase emails, and the
// NOWPayments `order_description` so the user sees a recognisable
// parent legal entity at every payment touchpoint.

export const COMPANY = {
  product: "MedPrüf",
  operator: "[name]",
  founder: "[name]",
  jurisdiction: "Österreich",
  legal_form_de: "Einzelunternehmen",
  legal_form_en: "sole proprietorship",
  // Single-line composition for footers/headers.
  one_line_de: "MedPrüf · betrieben von [name] · [name] · Österreich",
  one_line_en: "MedPrüf · operated by [name] · [name] · Austria",
  // Footer variant with explicit legal-form callout.
  footer_de:
    "MedPrüf ist ein Produkt von [name] (Einzelunternehmen · [name] · Österreich). Steuer- und Rechnungsdetails auf Anfrage: user-b7e46e80@example.com · Impressum: /impressum",
  footer_en:
    "MedPrüf is a product of [name] (sole proprietorship · [name] · Austria). Tax and invoice details on request: user-b7e46e80@example.com · Imprint: /impressum",
} as const;

// ── 8. Contact ─────────────────────────────────────────────────────

export const CONTACT = {
  // Single canonical support email. NEVER `support@`, `help@`,
  // `info@`, or `user-0a1d478f@example.com` (that one is for B2B / [name]
  // outbound only — never user-facing on MedPrüf).
  email: "user-b7e46e80@example.com",
  // [name]'s MedPrüf Telegram bot account. Used by cron jobs +
  // refund-request notifications.
  telegram_chat_id: 0,
  telegram_account: "medpruef",
  telegram_bot: "@MedPruefBot",
} as const;

// ── 9. Currency formatting ─────────────────────────────────────────
//
// Canonical pattern: number + thin-space + €. Never "€X", "EUR X",
// "X EUR", or "X€" with no separator.

export const CURRENCY = {
  symbol: "€",
  code: "EUR",
  // Use a regular space; tabular-nums comes from the CSS class
  // `.font-num` / Tailwind `tabular-nums`, not from Unicode.
  separator: " ",
} as const;

/** Format a euro value (in cents) using the canonical "X €" pattern. */
export function formatEuro(cents: number): string {
  if (!Number.isFinite(cents)) return "0 €";
  const whole = Math.round(cents / 100);
  return `${whole} €`;
}

/**
 * Format a euro value with two decimal places (for invoices / refunds
 * where the cent-precision matters). Same "X €" convention.
 */
export function formatEuroPrecise(cents: number): string {
  if (!Number.isFinite(cents)) return "0,00 €";
  const value = (cents / 100).toFixed(2).replace(".", ",");
  return `${value} €`;
}

// ── 10. Banned phrases (informational) ─────────────────────────────
//
// Not enforced by code — listed here so a future linter / CI grep
// rule can plug into the same source of truth. Walked against every
// user-facing string in `src/app/**`.

export const BANNED_PHRASES = [
  "nicht verfügbar",
  "Soft Launch",
  "soft launch",
  "limited time",
  "only X left", // unless literally true
  "€25-75 pro Anmeldung", // banned on first-touch surfaces specifically
  "Founders'",
  "Founders ", // trailing space — catches "Founders Prep" etc
  "game-changer",
  "revolutionary",
] as const;

// ── 11. Aggregate export ───────────────────────────────────────────
//
// Convenience top-level constant for surfaces that want a single
// import (`import { CONTENT_TRUTH } from "@/lib/content-truth"`).

export const CONTENT_TRUTH = {
  questions: QUESTIONS,
  tiers: TIERS,
  referral_payouts: REFERRAL_PAYOUTS,
  free_tier: FREE_TIER,
  refund: REFUND,
  puyp: PUYP,
  company: COMPANY,
  contact: CONTACT,
  currency: CURRENCY,
  banned_phrases: BANNED_PHRASES,
} as const;

export default CONTENT_TRUTH;
