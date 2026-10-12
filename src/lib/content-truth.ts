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
 *   - Address form: Sie ([name], pick-copy-register B, 2026-10-11). The
 *     site-wide switch from du is one reviewed pass; until it lands, new
 *     German strings use Sie or neutral wording (scripts/copy-lint/register-lint.mjs).
 *   - Zero exclamation marks on product surfaces.
 */

// ── 1. Question counts ─────────────────────────────────────────────
//
// This is a STATIC CACHE of a DB-owned fact. The authoritative count is
// `select count(*) from questions where is_active` (verified 10685 live
// on 2026-09-25). Keep public display copy rounded where possible.
// SOT-REF: medpruef_question_count@DB:medpruef.questions
//
// 2026-09-25 refresh: current active counts verified from the database.
// Earlier baseline (2026-04-24): was "10,993" through Apr 23; an
// off-by-one from a soft-deleted row that survived a partial archive,
// and Wien dropped 7,567 → 7,566 in that sweep.

// 2026-10-12 (a24, SIM-06-R): pharma is 322 active rows (13 inactivated in the
// content-leak repair); the live count is DB-owned and drifts, so copy says "über 300".
export const QUESTIONS = {
  total: 10672,
  by_exam_type: {
    kenntnispruefung: 7566,
    kmp_innsbruck: 2784,
    pharma: 322,
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
  // ── Tier hierarchy (2026-06-25 prices) ──────────────────────────
  // €19/month recurring entry (first_month_19); €49/quarter recurring
  // Starter (first_3mo_27); €129 = 6-month Cohort hero
  // (premium_pass_guaranteed, raised from €114). Keys are frozen data —
  // first_3mo_27 now displays €49. Cap: each user can subscribe to first_3mo_27
  // only ONCE — enforced server-side in /api/checkout/nowpayments.
  // After expiry the upgrade path is Cohort €129; first_month_19
  // stays live as a "just one more month" bridging fallback.
  first_3mo_27: {
    id: "first_3mo_27",
    price_cents: 4900, // €49 lump sum (raised from €27 on 2026-06-25)
    duration_months: 3,
    puyp_eligible: false, // 90 days is short of a real prep arc; PUYP starts at 6mo
    available: true,
    name: { de: "3-Monats-Einstieg", en: "3-Month Starter" },
    // Referral payout sized to encourage Telegram/social sharing while
    // keeping margin positive (€49 at the new price; €15 payout is sound).
    referral_payout_cents: 1500, // €15
  },
  first_month_19: {
    id: "first_month_19",
    price_cents: 1900,
    duration_months: 1,
    puyp_eligible: false, // 30 days is too short for PUYP
    // €19 is the advertised entry price (2026-06-25: price unchanged).
    // Stays available as a single bridging month for users whose 3-month
    // Starter has expired before they upgrade to the Cohort (€129).
    available: true,
    name: { de: "Einzelmonat", en: "Single Month" },
    referral_payout_cents: 1000, // €10 per COPY-BUNDLE §4
  },
  // ── Phantom tiers — removed from all UI 2026-06-25; dead data pending deletion ──
  // Keys kept: string literals in waitlist/non-crypto-waitlist APIs still reference them.
  monthly: {
    id: "monthly",
    price_cents: 2900,
    duration_months: 1,
    puyp_eligible: false,
    available: false, // removed from all UI 2026-06-25; dead data pending deletion
    name: { de: "Monatlich", en: "Monthly" },
    referral_payout_cents: 2500, // €25 per COPY-BUNDLE §4
  },
  three_month: {
    id: "three_month",
    price_cents: 7900,
    duration_months: 3,
    puyp_eligible: false,
    available: false, // removed from all UI 2026-06-25; dead data pending deletion
    name: { de: "3 Monate", en: "3 Months" },
    referral_payout_cents: 2500, // €25 per COPY-BUNDLE §4
  },
  six_month: {
    id: "six_month",
    price_cents: 14900,
    duration_months: 6,
    puyp_eligible: true,
    available: false, // removed from all UI 2026-06-25; dead data pending deletion
    name: { de: "6 Monate", en: "6 Months" },
    referral_payout_cents: 5000, // €50 per COPY-BUNDLE §4
  },
  twelve_month: {
    id: "twelve_month",
    price_cents: 22900,
    duration_months: 12,
    puyp_eligible: true,
    available: false, // removed from all UI 2026-06-25; dead data pending deletion
    name: { de: "12 Monate", en: "12 Months" },
    referral_payout_cents: 5000, // €50 per COPY-BUNDLE §4
  },
  premium_pass_guaranteed: {
    id: "premium_pass_guaranteed",
    price_cents: 12900, // €129 — raised from €114 on 2026-06-25
    duration_months: 6,
    puyp_eligible: true,
    available: true,
    // Cohort name is EXAM-NEUTRAL on purpose (2026-06-20, [name]'s call).
    // The old "Juni-26-Kohorte" drifted past its date; "Kenntnisprüfung-
    // Kohorte" was still exam-specific and excluded KMP/Pharma buyers.
    // "Prüfungs-Kohorte" / "Exam Cohort" stays correct as sittings move
    // (3x/year) AND across all three exams. The current exam date + soft
    // deadline live on the surfaces (banner/CTA + the exam calendar),
    // not in the tier name. Display-only — payment/PUYP/webhook key off
    // the `id` (premium_pass_guaranteed), never this string.
    name: { de: "Prüfungs-Kohorte", en: "Exam Cohort" },
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
  first_3mo_27: 1500, // €15 — 3-month Starter, sized for social/Telegram sharing
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
  // The one support mailbox (same value as CONTACT.email and
  // BILLING_SUPPORT_EMAIL; kept literal here to avoid a module cycle).
  email: "user-b7e46e80@example.com",
  // Refund route (pick-refund-route A): requested by email within 7 days of
  // a purchase, paid back through Whop. No processing-time promise until it
  // is measured; the reply promise lives in SUPPORT_REPLY_PROMISE.
  // Formal Sie, no em dashes.
  copy: {
    de: "Rückerstattung innerhalb von 7 Tagen nach einem Kauf: Schreiben Sie an user-b7e46e80@example.com. Die Rückzahlung erfolgt über Whop.",
    en: "Refund within 7 days of a purchase: email user-b7e46e80@example.com. The money is paid back through Whop.",
  },
} as const;

// ── 6. Pass-Until-You-Pass (PUYP) ──────────────────────────────────
//
// Eligible tiers (2026-06-25): Cohort (premium_pass_guaranteed) ONLY.
// The 6mo and 12mo phantom tiers carried PUYP in the old ladder but
// are now removed from all UI. NEVER on €19 or €49 or 3mo. The TIERS
// ledger above encodes this; the array below is a flat allow-list for
// comparison tables and FAQ logic.

export const PUYP_ELIGIBLE_TIERS: ReadonlyArray<TierId> = [
  // six_month and twelve_month phantom tiers removed from all UI 2026-06-25;
  // Cohort (premium_pass_guaranteed) is the sole PUYP-eligible live tier.
  "premium_pass_guaranteed",
];

export const PUYP = {
  eligible_tiers: PUYP_ELIGIBLE_TIERS,
  min_questions_completed_pct: 70,
  max_additional_cycles: 2,
  result_review_window_hours: 72,
} as const;

// ── 7. Operator identity ───────────────────────────────────────────
//
// Founder facts (pick-founder-facts A, [name] 2026-10-11; same statement as
// /impressum): MedPrüf is built and run by one person, [name], from
// Cairo (Egypt). Not a registered company, no VAT ID, no street address,
// no phone, no personal email on public surfaces. [name] is [name]'s
// trade name as named on /impressum, not a legal entity. Footers, About,
// FAQ, Impressum, Datenschutz and emails render from here (TR-15, UX-PUB-10).

export const COMPANY = {
  product: "MedPrüf",
  founder: "[name]",
  // Trade name shown on /impressum ("Betrieben durch"); not a company.
  operator_brand: "[name]",
  location: { de: "Kairo, Ägypten", en: "Cairo, Egypt" },
  // Single-line composition for footers and email signatures.
  one_line: {
    de: "MedPrüf · [name] · Kairo, Ägypten",
    en: "MedPrüf · [name] · Cairo, Egypt",
  },
  // One founder statement for About, FAQ "Wer baut MedPrüf?" and JSON-LD.
  statement: {
    de: "MedPrüf wird von einer Person entwickelt und betrieben: [name], aus Kairo (Ägypten). MedPrüf ist derzeit kein eingetragenes Unternehmen.",
    en: "MedPrüf is built and run by one person: [name], from Cairo (Egypt). MedPrüf is currently not a registered company.",
  },
} as const;

// ── 8. Contact ─────────────────────────────────────────────────────

export const CONTACT = {
  // The ONE support mailbox (same value as BILLING_SUPPORT_EMAIL). Never
  // `support@`, `help@`, `info@`, `privacy@`, `contact@` or
  // `user-0a1d478f@example.com` on MedPrüf surfaces.
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

// ── 10b. Learning-feature claim inputs (LX-30, UX-GLOBAL-07) ──────
//
// Public learning claims render from src/lib/guidance-data/learning-claims.copy.json
// through src/lib/learning-claims.ts; these constants fill their placeholders.
// tests/unit/track-b/b32-lx-pure-modules/learning-claims.test.ts checks them
// against the code that does the work.

export type ClaimLang = "de" | "en" | "ru" | "uk" | "tr" | "fr" | "sr" | "ar";

/**
 * Explanation and flash-note languages (translate route SUPPORTED_LANGS plus the
 * German original). Arabic is offered in the product but stays out of public
 * claims until [name] signs off its copy; French and Serbian carry an unreviewed
 * label (pick-language-scope A). Romanian and Persian are not offered.
 */
export const EXPLANATION_LANGUAGES = {
  original: "de",
  claimed: ["en", "ru", "uk", "tr"],
  unreviewed: ["fr", "sr"],
  pendingSignoff: ["ar"],
} as const satisfies { original: ClaimLang; claimed: readonly ClaimLang[]; unreviewed: readonly ClaimLang[]; pendingSignoff: readonly ClaimLang[] };

export const LANGUAGE_NAMES: Record<ClaimLang, { de: string; en: string }> = {
  de: { de: "Deutsch", en: "German" },
  en: { de: "Englisch", en: "English" },
  ru: { de: "Russisch", en: "Russian" },
  uk: { de: "Ukrainisch", en: "Ukrainian" },
  tr: { de: "Türkisch", en: "Turkish" },
  fr: { de: "Französisch", en: "French" },
  sr: { de: "Serbisch", en: "Serbian" },
  ar: { de: "Arabisch", en: "Arabic" },
};

/**
 * Public support promise ([name], pick-support-time B, 2026-10-11): replies in
 * 1 to 2 working days; question reports acknowledged within 3 working days.
 */
export const SUPPORT = {
  replyWorkingDays: { min: 1, max: 2 },
  reportAcknowledgeWorkingDays: 3,
} as const;

/**
 * AI explanations and translations are limited per day (src/lib/ai/limits.ts,
 * env-tunable), so public copy says "fair daily limit", never "unlimited".
 */
export const AI_DAILY_LIMIT_WORDING = {
  de: "mit fairem Tageslimit",
  en: "with a fair daily limit",
} as const;

/** Length of the timed exam simulation; mirrors EXAM_DURATION_S in src/app/exam/page.tsx. */
export const EXAM_SIMULATION_HOURS = 4;

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
  explanation_languages: EXPLANATION_LANGUAGES,
  support: SUPPORT,
} as const;

export default CONTENT_TRUTH;
