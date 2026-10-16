/**
 * "When is your exam?": the cheapest plan that covers the learner's sitting,
 * with each plan's total to that sitting (decision sitting-fit, D-B as
 * amended by the CEO review of 15 Oct 2026). Computed from the purchase
 * instant with the plans' own renewal rules; copy never states a break-even.
 *
 *   Monthly    one charge every 30 days from the purchase until the access
 *              reaches the end of the sitting's last day
 *   Sitting    one charge; the grant's own end (sittingPassEnd: the day after
 *   Pass       the sitting, at least 30 days, at most 3 months) must reach it
 *   6 months   one charge every 180 days. A renewal on or after the first
 *              Vienna day after the sitting never charges (stopDue,
 *              half-year-server.ts). With the renewal guard on, a renewal
 *              inside the 14 days before the sitting does not charge either:
 *              the plan stops and access runs on to the day after the sitting
 *              (renewal-guard.ts). With the guard off that renewal is a
 *              second charge and the total shows it.
 *   Ticket     one charge, 12 months; a sitting after that is covered by a
 *              free renewal year on proof of the booking (ticket.ts)
 *
 * "Covers" means access until the end of the sitting's last day (Vienna).
 * The highlight is the cheapest covering plan the page can sell right now
 * (readiness); a tie goes to the shorter commitment.
 *
 * Pure, client-safe.
 */
import { TIERS } from "@/lib/content-truth";
import type { V2Tier } from "./offer";
import { sittingPassEnd, viennaMidnight } from "./sitting-pass";
import { RENEWAL_GUARD_DAYS, guardAccessUntil, renewalGuardApplies, type GuardSitting } from "./renewal-guard";

const DAY_MS = 86_400_000;
/** Shorter commitment first; the same order as V2_PLAN_ORDER (offer.ts imports this module). */
const FIT_ORDER: readonly V2Tier[] = ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"];
export const FLEX_CYCLE_DAYS = 30;
export const HALF_YEAR_CYCLE_DAYS = 180;
/** Upper bound for the loops; no published sitting is anywhere near it. */
const MAX_CYCLES = 60;

function addDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function addMonthsUtc(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** End of the sitting's last day in Vienna (the first instant after it). */
export function sittingCoveredFrom(lastDay: string): Date {
  return viennaMidnight(addDays(lastDay, 1));
}

export interface PlanFit {
  tier: V2Tier;
  /** Access reaches the end of the sitting's last day. */
  covers: boolean;
  /** Charges up to and including the sitting. */
  charges: number;
  totalCents: number;
  /** Access end the plan gives for this purchase, when it is a fixed date (pass, ticket, guarded 6 months). */
  accessUntil: string | null;
  /** 6 months: the renewal that the guard stops (ISO), null otherwise. */
  guardedRenewalAt: string | null;
  /** Ticket: the sitting lies after the 12 months; a free renewal year on proof covers it. */
  needsRenewalYear: boolean;
}

export interface SittingFit {
  plans: Record<V2Tier, PlanFit>;
  /** Cheapest covering plan among the sellable ones (all plans when none is sellable). */
  recommended: V2Tier;
}

export interface FitOptions {
  /** The renewal guard runs for real (HALF_YEAR_AUTO_STOP live). */
  guard: boolean;
  /** Plans the page can sell now (readiness); default: all. */
  ready?: Partial<Record<V2Tier, boolean>>;
}

function cyclesUntil(now: Date, cycleDays: number, until: Date): number {
  let n = 1;
  while (n < MAX_CYCLES && now.getTime() + n * cycleDays * DAY_MS < until.getTime()) n++;
  return n;
}

export function flexFit(sitting: GuardSitting, now: Date): PlanFit {
  const charges = cyclesUntil(now, FLEX_CYCLE_DAYS, sittingCoveredFrom(sitting.lastDay));
  return { tier: "flex_month", covers: true, charges, totalCents: charges * TIERS.flex_month.price_cents, accessUntil: null, guardedRenewalAt: null, needsRenewalYear: false };
}

export function passFit(sitting: GuardSitting, now: Date): PlanFit {
  const end = sittingPassEnd(sitting.lastDay, now);
  return {
    tier: "sitting_pass",
    covers: end.getTime() >= sittingCoveredFrom(sitting.lastDay).getTime(),
    charges: 1,
    totalCents: TIERS.sitting_pass.price_cents,
    accessUntil: end.toISOString(),
    guardedRenewalAt: null,
    needsRenewalYear: false,
  };
}

export function halfYearFit(sitting: GuardSitting, now: Date, guard: boolean): PlanFit {
  const covered = sittingCoveredFrom(sitting.lastDay).getTime();
  let charges = 1;
  let guardedRenewalAt: string | null = null;
  let accessUntil: string | null = null;
  while (charges < MAX_CYCLES) {
    const renewal = new Date(now.getTime() + charges * HALF_YEAR_CYCLE_DAYS * DAY_MS);
    // The paid period reaches the end of the sitting: the next renewal is on
    // or after the first Vienna day after it, and stopDue stops it.
    if (renewal.getTime() >= covered) break;
    if (guard && renewalGuardApplies(renewal, sitting)) {
      guardedRenewalAt = renewal.toISOString();
      accessUntil = guardAccessUntil(sitting).toISOString();
      break;
    }
    charges++;
  }
  return { tier: "half_year", covers: true, charges, totalCents: charges * TIERS.half_year.price_cents, accessUntil, guardedRenewalAt, needsRenewalYear: false };
}

export function ticketFit(sitting: GuardSitting, now: Date): PlanFit {
  const end = addMonthsUtc(now, 12);
  return {
    tier: "guarantee_ticket",
    covers: true,
    charges: 1,
    totalCents: TIERS.guarantee_ticket.price_cents,
    accessUntil: end.toISOString(),
    guardedRenewalAt: null,
    needsRenewalYear: end.getTime() < sittingCoveredFrom(sitting.lastDay).getTime(),
  };
}

export function sittingFit(sitting: GuardSitting, now: Date, options: FitOptions): SittingFit {
  const plans: Record<V2Tier, PlanFit> = {
    flex_month: flexFit(sitting, now),
    sitting_pass: passFit(sitting, now),
    half_year: halfYearFit(sitting, now, options.guard),
    guarantee_ticket: ticketFit(sitting, now),
  };
  const covering = FIT_ORDER.filter((t) => plans[t].covers);
  const sellable = covering.filter((t) => options.ready?.[t] ?? true);
  const pool = sellable.length > 0 ? sellable : covering;
  // Strictly cheaper wins; FIT_ORDER breaks ties (shorter commitment first).
  const recommended = pool.reduce((best, t) => (plans[t].totalCents < plans[best].totalCents ? t : best), pool[0]);
  return { plans, recommended };
}

export { RENEWAL_GUARD_DAYS };
