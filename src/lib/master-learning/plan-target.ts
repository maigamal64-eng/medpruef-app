/**
 * Study-plan target (LX-01-R, LX-03-R). Pure: no clock, no Supabase.
 *
 * Decision pick-plan-target (option A): every learner gets a plan toward the
 * next official sitting of the bank, labelled provisional, and users.exam_date
 * is never written from here. A chosen date stays a separate, reported share.
 *
 * track-A passes the future sittings of the active bank (getFutureSittings from
 * exam-dates.ts), so no date is typed in this file.
 */
import { t } from "../i18n";


export type PlanTargetSource =
  | "user_exam_date"
  | "next_official_sitting"
  | "fallback_horizon";

export interface SittingLike {
  /** ISO YYYY-MM-DD */
  date: string;
}

export interface PlanTarget {
  targetDate: string;
  /** true until the learner chooses a date of their own. */
  provisional: boolean;
  source: PlanTargetSource;
  daysLeft: number;
  /** Set when the learner's own date lies in the past. */
  expired: boolean;
}

/** 12 weeks (STU-26): used when the bank lists no future sitting. */
export const FALLBACK_HORIZON_DAYS = 84;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export function addDays(iso: string, n: number): string {
  return new Date((dayNumber(iso) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Up to n sittings on or after today, ascending, de-duplicated by date. */
export function nextSittings(
  sittings: readonly SittingLike[],
  now: Date,
  n = 3,
): SittingLike[] {
  const today = isoDay(now);
  const seen = new Set<string>();
  return [...sittings]
    .filter((s) => ISO_DAY.test(s.date) && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((s) => (seen.has(s.date) ? false : (seen.add(s.date), true)))
    .slice(0, Math.max(0, n));
}

export interface ResolvePlanTargetInput {
  /** users.exam_date (ISO) or null. */
  examDate: string | null | undefined;
  sittings: readonly SittingLike[];
  now: Date;
  fallbackDays?: number;
}

export function resolvePlanTarget(input: ResolvePlanTargetInput): PlanTarget {
  const today = isoDay(input.now);
  const own = input.examDate && ISO_DAY.test(input.examDate) ? input.examDate : null;
  if (own) {
    const left = daysBetween(today, own);
    if (left >= 0) {
      return { targetDate: own, provisional: false, source: "user_exam_date", daysLeft: left, expired: false };
    }
  }
  const expired = own !== null;
  // No date, or the own date is past: plan toward the next sitting (LX-03-R).
  const next = nextSittings(input.sittings, input.now, 1)[0];
  if (next) {
    return {
      targetDate: next.date,
      provisional: true,
      source: "next_official_sitting",
      daysLeft: daysBetween(today, next.date),
      expired,
    };
  }
  const horizon = input.fallbackDays ?? FALLBACK_HORIZON_DAYS;
  return {
    targetDate: addDays(today, horizon),
    provisional: true,
    source: "fallback_horizon",
    daysLeft: horizon,
    expired,
  };
}

export interface PlanTargetShares {
  learners: number;
  withExamDate: number;
  withPlanTarget: number;
  withExamDateShare: number;
  withPlanTargetShare: number;
}

/**
 * The two shares D-LX-01 reports side by side. A learner with a plan target is
 * anyone the resolver gives a plan to (every onboarded learner after LX-01-R).
 */
export function planTargetShares(
  rows: readonly { examDate: string | null | undefined }[],
  sittings: readonly SittingLike[],
  now: Date,
): PlanTargetShares {
  let withExamDate = 0;
  let withPlanTarget = 0;
  for (const r of rows) {
    if (r.examDate && ISO_DAY.test(r.examDate) && r.examDate >= isoDay(now)) withExamDate += 1;
    const t = resolvePlanTarget({ examDate: r.examDate, sittings, now });
    if (t.targetDate) withPlanTarget += 1;
  }
  const learners = rows.length;
  const share = (n: number) => (learners === 0 ? 0 : n / learners);
  return {
    learners,
    withExamDate,
    withPlanTarget,
    withExamDateShare: share(withExamDate),
    withPlanTargetShare: share(withPlanTarget),
  };
}

/** Learner-facing label for a provisional target (DE and EN). */
export function provisionalLabel(lang: "de" | "en"): string {
  return t("a12_plan_provisional", lang);
}
