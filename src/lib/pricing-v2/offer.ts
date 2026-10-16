/**
 * The v2 offer, defined once (a-pricing-v2, track-A CEO decision 15 Oct 2026
 * under [name]'s delegation; decisions.json pricing-v2):
 *
 *   flex_month        24 EUR per 30 days, renews until cancelled
 *   sitting_pass      59 EUR once, until the day after the learner's chosen
 *                     official sitting, at least 30 days, at most 3 months
 *   half_year         100 EUR per 6 months, renews, but the renewal stops by
 *                     itself once the learner's exam date has passed; a
 *                     reminder goes 7 days before every renewal
 *   guarantee_ticket  179 EUR once, 12 months, Mentor credits included
 *                     (the Cohort level per 30-day slice) and up to two
 *                     free renewal years on proof
 *
 * Prices come from content-truth TIERS, never typed here. Every existing
 * payer keeps their plan, price and renewals: these keys are new and the old
 * ones stay known to every grant, revoke and display path.
 *
 * Pure (no I/O). Copy lives in ./copy.ts.
 */
import { TIERS } from "@/lib/content-truth";
import { pricingV2Enabled } from "./flag";
import { sittingFit, type FitOptions } from "./fit";

export type V2Tier = "flex_month" | "sitting_pass" | "half_year" | "guarantee_ticket";
export type V1Tier = "first_month_19" | "first_3mo_27" | "premium_pass_guaranteed";

export const V2_TIERS: readonly V2Tier[] = ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"];
export const V1_TIERS: readonly V1Tier[] = ["first_month_19", "first_3mo_27", "premium_pass_guaranteed"];

/** Page order: shortest commitment first, all four always visible. */
export const V2_PLAN_ORDER: readonly V2Tier[] = ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"];

export function isV2Tier(tier: unknown): tier is V2Tier {
  return typeof tier === "string" && (V2_TIERS as readonly string[]).includes(tier);
}

/** Renewal interval in days; null = one payment. */
export const V2_CADENCE_DAYS: Record<V2Tier, number | null> = {
  flex_month: 30,
  sitting_pass: null,
  half_year: 180,
  guarantee_ticket: null,
};

export function v2PriceCents(tier: V2Tier): number {
  return TIERS[tier].price_cents;
}

/**
 * Tiers a NEW checkout may buy right now. Flag off: today's three plans,
 * unchanged. Flag on: the four v2 plans only (the 19, 49 and 129 plans are
 * no longer sold to new buyers; their renewals and data stay).
 */
export function checkoutTiers(env?: Record<string, string | undefined>): ReadonlySet<string> {
  return new Set<string>(pricingV2Enabled(env) ? V2_TIERS : V1_TIERS);
}

/**
 * Tiers a RETURNING buyer may be granted for (checkout/verify, admin link):
 * always both sets, because a buyer who opened Whop before a flip comes
 * back after it.
 */
export const GRANTABLE_TIERS: ReadonlySet<string> = new Set<string>([...V1_TIERS, ...V2_TIERS]);

/** One-time v2 plans are never extendable from a running access end. */
export function isOneTimeV2(tier: string): boolean {
  return tier === "sitting_pass" || tier === "guarantee_ticket";
}

// ── "When is your exam?" ────────────────────────────────────────────

export type ExamTiming =
  | { kind: "sitting"; lastDay: string; date?: string }
  | { kind: "long_route" }
  | { kind: "after_fail" }
  | { kind: "unsure" };

const DAY_MS = 86_400_000;

/** Whole days from now to the end of an ISO day (UTC-day granularity, like exam-dates.ts). */
export function daysUntil(isoDay: string, now: Date = new Date()): number {
  const target = Date.parse(`${isoDay}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - today) / DAY_MS);
}

/**
 * The one plan the page highlights. All plans stay visible.
 *   - a chosen sitting: the cheapest plan that covers it, with every renewal
 *     rule applied (fit.ts; decision sitting-fit, D-B). Monthly wins within
 *     two 30-day cycles, the Sitting Pass from there up to 3 months, 6 months
 *     when its paid periods (and, with the guard on, the renewal guard)
 *     reach the sitting, the Guarantee Ticket when it is the cheapest cover.
 *   - the long Vienna route, or after a failed attempt: Guarantee Ticket
 *   - not sure yet: Monthly
 * `options` defaults to the guard off and every plan sellable.
 */
export function recommendTier(timing: ExamTiming, now: Date = new Date(), options: FitOptions = { guard: false }): V2Tier {
  switch (timing.kind) {
    case "unsure":
      return "flex_month";
    case "long_route":
    case "after_fail":
      return "guarantee_ticket";
    case "sitting":
      return sittingFit({ date: timing.date ?? timing.lastDay, lastDay: timing.lastDay }, now, options).recommended;
  }
}

/** The advertised "Pro from X per month" figure: 19 EUR today, 24 EUR with the v2 offer. */
export function entryMonthlyCents(): number {
  return pricingV2Enabled() ? TIERS.flex_month.price_cents : TIERS.first_month_19.price_cents;
}
