/**
 * Plan cover (LX-28): what each paid plan costs to cover the time until a
 * learner's sitting. Pure, no I/O. Prices are read from the one price owner
 * (`TIERS` in src/lib/content-truth.ts), never retyped here.
 *
 * Access lengths follow the Whop plans in src/lib/billing-copy.ts:
 *   - Monthly (first_month_19): 30 days per payment, renews until cancelled
 *   - 3 months (first_3mo_27): 90 days per payment, renews until cancelled
 *   - Exam Cohort (premium_pass_guaranteed): 6 months, one-time
 * A period that only partly overlaps the sitting still has to be paid in
 * full, so every count rounds up. The comparison never recommends a plan by
 * itself; the page shows all three totals and marks the cheapest one.
 */
import { TIERS } from "./content-truth";

export type CoverPlan = "first_month_19" | "first_3mo_27" | "premium_pass_guaranteed";

const DAY_MS = 86_400_000;
/** Access days bought by one payment of each plan. */
export const PLAN_PERIOD_DAYS: Readonly<Record<CoverPlan, number>> = {
  first_month_19: 30,
  first_3mo_27: 90,
  premium_pass_guaranteed: 183, // 6 calendar months, rounded up to whole days
};
export const COVER_PLANS: readonly CoverPlan[] = ["first_month_19", "first_3mo_27", "premium_pass_guaranteed"];

export interface PlanCover {
  plan: CoverPlan;
  /** Payments needed to keep access through the sitting. */
  payments: number;
  totalCents: number;
}

export interface CoverComparison {
  /** Whole months shown to the learner (30-day months, at least 1). */
  months: number;
  days: number;
  covers: PlanCover[];
  /** Lowest total; on a tie the plan with fewer payments wins. */
  cheapest: CoverPlan;
}

function priceCents(plan: CoverPlan): number {
  return TIERS[plan].price_cents;
}

/** Days from `now` until an ISO date (YYYY-MM-DD or full timestamp). Null when unreadable. */
export function daysUntil(dateIso: string, now: Date = new Date()): number | null {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? `${dateIso}T12:00:00Z` : dateIso;
  const target = Date.parse(day);
  if (!Number.isFinite(target)) return null;
  return Math.ceil((target - now.getTime()) / DAY_MS);
}

/** Months until a sitting, for the line "N Monate bis zu Ihrem Termin". Null when past or unreadable. */
export function monthsUntil(dateIso: string, now: Date = new Date()): number | null {
  const days = daysUntil(dateIso, now);
  if (days === null || days <= 0) return null;
  return Math.max(1, Math.ceil(days / 30));
}

/** Cost of covering `days` of access with each plan. */
export function coverCostForDays(days: number): CoverComparison {
  const span = Math.max(1, Math.ceil(days));
  const covers = COVER_PLANS.map((plan) => {
    const payments = Math.ceil(span / PLAN_PERIOD_DAYS[plan]);
    return { plan, payments, totalCents: payments * priceCents(plan) };
  });
  const cheapest = [...covers].sort((a, b) => a.totalCents - b.totalCents || a.payments - b.payments)[0].plan;
  return { months: Math.max(1, Math.ceil(span / 30)), days: span, covers, cheapest };
}

/** Cost of covering a whole number of 30-day months (the logged-out 3, 4 and 6 month table). */
export function coverCost(months: number): CoverComparison {
  return coverCostForDays(Math.max(1, Math.ceil(months)) * 30);
}

/** Cover until a sitting date, or null when the date is past or unreadable. */
export function coverUntil(dateIso: string, now: Date = new Date()): CoverComparison | null {
  const days = daysUntil(dateIso, now);
  if (days === null || days <= 0) return null;
  return coverCostForDays(days);
}
