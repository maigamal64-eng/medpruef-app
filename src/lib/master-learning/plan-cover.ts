/**
 * What each plan costs to cover the months until the sitting (LX-28-R). Pure.
 * Prices come from content-truth TIERS (the code owner of the numbers); nothing
 * is copied here. No price changes.
 */
import { TIERS } from "@/lib/content-truth";

export interface CoverPrices {
  monthlyEur: number;
  quarterlyEur: number;
  cohortEur: number;
  cohortMonths: number;
}

export const DEFAULT_PRICES: CoverPrices = {
  monthlyEur: TIERS.first_month_19.price_cents / 100,
  quarterlyEur: TIERS.first_3mo_27.price_cents / 100,
  cohortEur: TIERS.premium_pass_guaranteed.price_cents / 100,
  cohortMonths: TIERS.premium_pass_guaranteed.duration_months,
};

export type CoverPlanId = "monthly" | "quarterly" | "cohort";

export interface CoverOption {
  plan: CoverPlanId;
  /** Number of purchases needed to cover the months. */
  units: number;
  totalEur: number;
}

export interface CoverResult {
  months: number;
  options: CoverOption[];
  cheapest: CoverPlanId;
}

const DAY_MS = 86_400_000;
const DAYS_PER_MONTH = 30;

/** Whole months (rounded up, at least 1) from today to the sitting; null when there is none or it passed. */
export function monthsUntil(sittingIso: string | null | undefined, now: Date): number | null {
  if (!sittingIso || !/^\d{4}-\d{2}-\d{2}$/.test(sittingIso)) return null;
  const days = Math.floor((Date.parse(`${sittingIso}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / DAY_MS);
  if (days < 0) return null;
  return Math.max(1, Math.ceil(days / DAYS_PER_MONTH));
}

export function coverCost(months: number, prices: CoverPrices = DEFAULT_PRICES): CoverResult {
  const m = Math.max(1, Math.ceil(months));
  const options: CoverOption[] = [
    { plan: "monthly", units: m, totalEur: m * prices.monthlyEur },
    { plan: "quarterly", units: Math.ceil(m / 3), totalEur: Math.ceil(m / 3) * prices.quarterlyEur },
    { plan: "cohort", units: Math.ceil(m / prices.cohortMonths), totalEur: Math.ceil(m / prices.cohortMonths) * prices.cohortEur },
  ];
  // Cheapest total wins; a tie goes to the plan with fewer renewals to manage.
  const order: CoverPlanId[] = ["cohort", "quarterly", "monthly"];
  const cheapest = [...options].sort(
    (a, b) => a.totalEur - b.totalEur || order.indexOf(a.plan) - order.indexOf(b.plan),
  )[0].plan;
  return { months: m, options, cheapest };
}

/** Logged-out visitors see these horizons (3, 4 and 6 months). */
export const LOGGED_OUT_HORIZONS = [3, 4, 6] as const;

export function loggedOutTotals(prices: CoverPrices = DEFAULT_PRICES): CoverResult[] {
  return LOGGED_OUT_HORIZONS.map((m) => coverCost(m, prices));
}

export function monthsLabel(months: number, lang: "de" | "en"): string {
  if (lang === "de") return `${months} ${months === 1 ? "Monat" : "Monate"} bis zu deinem Termin`;
  return `${months} ${months === 1 ? "month" : "months"} until your date`;
}
