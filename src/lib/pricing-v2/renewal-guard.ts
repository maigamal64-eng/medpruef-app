/**
 * The 6-month renewal guard (decision renewal-guard, 15 Oct 2026; built in
 * a-pricing-v2-fit).
 *
 * a-pricing-v2's stop rule (stopDue) stops a renewal only when it falls on or
 * after the first Vienna day after the exam. A plan bought on 4 Nov for a
 * 4 May sitting renews on 3 May, the day before: that would charge a full
 * 180-day period for a few days of use. The guard closes that gap:
 *
 *   a renewal from 00:00 Vienna 14 days before the sitting's first day up to
 *   the end of its last day does not charge. The app sets
 *   cancel_at_period_end at Whop (never an immediate cancel, no refund) and
 *   access runs on without a charge until the end of the day after the
 *   sitting (the same end the Sitting Pass uses).
 *
 * Renewals on or after the first day after the sitting stay with stopDue.
 * Pure, client-safe; the cron (half-year-server.ts) and the totals on
 * /pricing (fit.ts) share these functions.
 */
import { dayAfterEnd, viennaMidnight } from "./sitting-pass";

export const RENEWAL_GUARD_DAYS = 14;
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The sitting a 6-month plan is guarded for: first and last day (an exam week spans several). */
export interface GuardSitting {
  date: string;
  lastDay: string;
}

function addDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function validGuardSitting(s: Partial<GuardSitting> | null | undefined): s is GuardSitting {
  return Boolean(s && typeof s.date === "string" && ISO_DAY.test(s.date) && typeof s.lastDay === "string" &&
    ISO_DAY.test(s.lastDay) && s.date <= s.lastDay);
}

/** First instant of the guard window: 00:00 Vienna, 14 days before the sitting's first day. */
export function guardWindowStart(sitting: GuardSitting): Date {
  return viennaMidnight(addDays(sitting.date, -RENEWAL_GUARD_DAYS));
}

/** Does a renewal at `chargeAt` fall inside the guard window? */
export function renewalGuardApplies(chargeAt: Date | string, sitting: GuardSitting): boolean {
  if (!validGuardSitting(sitting)) return false;
  const at = typeof chargeAt === "string" ? Date.parse(chargeAt) : chargeAt.getTime();
  if (!Number.isFinite(at)) return false;
  const end = viennaMidnight(addDays(sitting.lastDay, 1)).getTime();
  return at >= guardWindowStart(sitting).getTime() && at < end;
}

/** Where the access runs to without a charge: the end of the day after the sitting. */
export function guardAccessUntil(sitting: GuardSitting): Date {
  return dayAfterEnd(sitting.lastDay);
}

/**
 * The cron acts in the same window as stopDue (the charge within 8 days),
 * so a learner who books a later sitting can still change the date first.
 */
export function guardDue(sitting: GuardSitting | null, nextChargeAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!sitting || !nextChargeAt) return false;
  const charge = Date.parse(nextChargeAt);
  if (!Number.isFinite(charge) || charge <= now.getTime()) return false;
  return charge - now.getTime() <= 8 * DAY_MS && renewalGuardApplies(new Date(charge), sitting);
}
