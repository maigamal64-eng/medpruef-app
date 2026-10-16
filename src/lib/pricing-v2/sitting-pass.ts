/**
 * Sitting Pass end date and the sitting choice (a-pricing-v2).
 *
 * The pass runs until the end of the day after the learner's chosen official
 * sitting (Vienna time; an exam week counts to its last day), at least 30
 * days and at most 3 months from the grant. It is NEVER open-ended: a missing
 * or unreadable choice grants the 3-month maximum, never null (compare.json
 * gap: a missing end date must never mean lifetime access).
 *
 * The choice is validated on the server against OFFICIAL_SITTINGS (bank +
 * date of an upcoming date group), so a client cannot name an arbitrary day.
 * A row whose registration window is unconfirmed still has a confirmed
 * sitting date (exam-dates.ts window_unconfirmed), so it is a valid choice
 * here; only its window is withheld elsewhere.
 *
 * Pure (no I/O), client-safe (no Node imports).
 */
import {
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  asPuypExamType,
  getUpcomingOfficialFor,
  groupOfficialByDate,
  type OfficialSitting,
  type PuypExamType,
} from "@/lib/exam-dates";

/** Same month arithmetic as computeExpiry (nowpayments.ts), kept here so this module stays client-safe. */
function addMonthsUtc(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export const SITTING_PASS_MIN_DAYS = 30;
export const SITTING_PASS_MAX_MONTHS = 3;
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface SittingChoice {
  bank: PuypExamType;
  /** Sitting date (first day of an exam week). */
  date: string;
  /** Last day of the sitting (the exam week end, else the date). */
  lastDay: string;
}

/**
 * Upcoming sittings a learner can pick for a bank, one per date group.
 * Same rows the shared ExamSittingPicker shows.
 */
export function sittingOptions(
  bank: PuypExamType,
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): SittingChoice[] {
  const groups = groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[bank], now }, sittings));
  return groups.map((g) => ({ bank, date: g.date, lastDay: g.date_end ?? g.date }));
}

/**
 * Validate a client's choice: the bank must be one of the three and the date
 * must be an upcoming official date group of that bank. Returns null otherwise.
 */
export function resolveSittingChoice(
  bankRaw: unknown,
  dateRaw: unknown,
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): SittingChoice | null {
  const bank = asPuypExamType(bankRaw);
  if (!bank || typeof dateRaw !== "string" || !ISO_DAY.test(dateRaw)) return null;
  return sittingOptions(bank, now, sittings).find((s) => s.date === dateRaw) ?? null;
}

/** The UTC instant of 00:00 on an ISO day in Europe/Vienna. */
export function viennaMidnight(isoDay: string): Date {
  const [y, m, d] = isoDay.split("-").map((n) => parseInt(n, 10));
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Vienna's offset at that wall time (+1 h or +2 h); DST switches at 02:00,
  // never at midnight, so one probe is exact.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (local - guess));
}

function addDays(isoDay: string, days: number): string {
  const t = Date.parse(`${isoDay}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** End of the day after `lastDay` in Vienna = midnight two days after it. */
export function dayAfterEnd(lastDay: string): Date {
  return viennaMidnight(addDays(lastDay, 2));
}

/**
 * The pass's access end for a grant at `now`. `lastDay` is the validated
 * sitting's last day, or null when the choice is missing or unreadable.
 * Always a finite date between now + 30 days and now + 3 months.
 */
export function sittingPassEnd(lastDay: string | null | undefined, now: Date = new Date()): Date {
  const max = addMonthsUtc(now, SITTING_PASS_MAX_MONTHS);
  if (typeof lastDay !== "string" || !ISO_DAY.test(lastDay) || !Number.isFinite(Date.parse(`${lastDay}T00:00:00Z`))) return max;
  const min = new Date(now.getTime() + SITTING_PASS_MIN_DAYS * DAY_MS);
  const wanted = dayAfterEnd(lastDay);
  if (wanted.getTime() < min.getTime()) return min;
  if (wanted.getTime() > max.getTime()) return max;
  return wanted;
}

/**
 * Whole months used for the granted_payment_ids entry (the revoke paths
 * recompute surviving windows from `added_months`): the pass length rounded
 * UP, 1 to 3, so a recomputed window is never shorter than what was sold.
 */
export function sittingPassAddedMonths(end: Date, now: Date = new Date()): number {
  const days = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
  return Math.min(SITTING_PASS_MAX_MONTHS, Math.max(1, Math.ceil(days / 30)));
}
