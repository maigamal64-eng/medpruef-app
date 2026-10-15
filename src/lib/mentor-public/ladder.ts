/**
 * Public mentor ladder numbers (pick-mentor-allowance A, [name] pricing A).
 *
 * SOT-REF: ai_credit_package seed rows in
 * supabase/migrations/20261022100000_mentor_ledger.sql (mentor_basis,
 * included_pro_monthly, included_pro_quarterly, included_cohort, mentor_topup).
 * The database owns these values; this module is the single client-safe copy
 * for public pages that cannot read the auth-gated /api/mentor/packages.
 * tests/unit/a39-public-copy/ladder-seed.test.ts parses the seed SQL and fails
 * when any number here drifts. Never type these numbers anywhere else.
 *
 * a-free-credit-hooks (L1): the Pro and Cohort included numbers are the
 * MENTOR_INCLUDED_RAISE_ENABLED amounts owned by src/lib/mentor/credits/
 * free-credits.ts (200 and 400), not the seed rows (50 and 150, still granted
 * while that flag is off). Every sentence that shows them sits behind
 * NEXT_PUBLIC_MENTOR_INCLUDED_COPY, which goes on only after the raise flag
 * and the house-grant scope are on (release note a-free-credit-hooks).
 */
import { FREE_CREDIT_DEFAULTS } from "@/lib/mentor/credits/free-credits";

/** One credit in micro-USD (same as CREDIT_MICRO_USD in src/lib/mentor/config.ts). */
export const MENTOR_CREDIT_MICRO_USD = 5_000;

export const MENTOR_LADDER = {
  /** included_pro_monthly and included_pro_quarterly: credits per 30-day slice. */
  pro: { credits: FREE_CREDIT_DEFAULTS.proIncludedCredits, periodDays: 30 },
  /** included_cohort: credits per 30-day slice of the 6-month cohort. */
  cohort: { credits: FREE_CREDIT_DEFAULTS.cohortIncludedCredits, periodDays: 30 },
  /** mentor_basis: subscription, renews every periodDays, lot lives expiryDays. */
  basis: { priceCents: 490, credits: 150, periodDays: 30, expiryDays: 33 },
} as const;

/** Days a subscription lot stays usable after its period ends (expiry minus period). */
export const MENTOR_GRACE_DAYS = MENTOR_LADDER.basis.expiryDays - MENTOR_LADDER.basis.periodDays;

export type IncludedPlan = "pro" | "cohort";

/** Included monthly mentor credits for a paid plan. */
export function includedMentorCredits(plan: IncludedPlan): number {
  return MENTOR_LADDER[plan].credits;
}
