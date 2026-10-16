/**
 * Day-2 and day-7 return by segment (a-activation-48h). Pure; the reader is
 * scripts/activation/return-by-segment.ts. Counts only, never a learner id.
 *
 * Definitions (Europe/Vienna calendar days, day 0 = the signup day):
 *  - active on a day: at least one stored answer (answer_history) that day.
 *  - returned on day 2: active on day 1 or day 2.
 *  - returned in week 1 ("day 7"): active on any of days 3 to 7.
 *  - active days in week 1: distinct active days among days 0 to 6.
 * A cohort counts toward day 2 only once day 2 has ended (signup day at most
 * today minus 3), toward day 7 only once day 7 has ended (today minus 8).
 */

export interface CohortLearner {
  /** Vienna signup day, YYYY-MM-DD. */
  signupDay: string;
  segment: string;
  lang: string;
  hasDate: boolean;
  onboarded: boolean;
  telegram: boolean;
  /** Vienna day (YYYY-MM-DD) to answers stored that day. */
  answersByDay: Readonly<Record<string, number>>;
  /** activation_step steps this learner reported (empty before the flag). */
  steps?: readonly string[];
}

export function dayOffset(signupDay: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${signupDay}T00:00:00Z`)) / 86_400_000);
}

export interface LearnerReturn {
  answersDay0: number;
  returnedDay2: boolean;
  returnedWeek1: boolean;
  activeDaysWeek1: number;
}

export function learnerReturn(l: CohortLearner): LearnerReturn {
  let answersDay0 = 0;
  let returnedDay2 = false;
  let returnedWeek1 = false;
  let activeDaysWeek1 = 0;
  for (const [day, n] of Object.entries(l.answersByDay)) {
    if (!(n > 0)) continue;
    const d = dayOffset(l.signupDay, day);
    if (d === 0) answersDay0 += n;
    if (d === 1 || d === 2) returnedDay2 = true;
    if (d >= 3 && d <= 7) returnedWeek1 = true;
    if (d >= 0 && d <= 6) activeDaysWeek1++;
  }
  return { answersDay0, returnedDay2, returnedWeek1, activeDaysWeek1 };
}

export function day0Bucket(n: number): "0" | "1-9" | "10-29" | "30+" {
  if (n <= 0) return "0";
  if (n < 10) return "1-9";
  if (n < 30) return "10-29";
  return "30+";
}

export interface ReturnRow {
  group: string;
  value: string;
  /** Learners whose day 2 has ended. */
  n_day2: number;
  returned_day2: number;
  /** Learners whose day 7 has ended. */
  n_week1: number;
  returned_week1: number;
  answered_day0: number;
  ten_day0: number;
  avg_active_days_week1: number | null;
}

const GROUPS: Record<string, (l: CohortLearner, r: LearnerReturn) => string> = {
  all: () => "all",
  segment: (l) => l.segment,
  segment_date: (l) => `${l.segment}:${l.hasDate ? "date" : "no_date"}`,
  lang: (l) => l.lang,
  onboarded: (l) => String(l.onboarded),
  telegram: (l) => String(l.telegram),
  day0_answers: (_l, r) => day0Bucket(r.answersDay0),
  starter_started: (l) => String((l.steps ?? []).includes("starter_started")),
  first_win_step: (l) => String((l.steps ?? []).includes("first_win")),
};

export const RETURN_GROUPS = Object.keys(GROUPS);

/** One row per group and value. `today` is the Vienna day the read ran. */
export function returnBySegment(learners: readonly CohortLearner[], today: string): ReturnRow[] {
  const rows = new Map<string, ReturnRow & { activeSum: number }>();
  for (const l of learners) {
    const age = dayOffset(l.signupDay, today);
    if (age < 3) continue; // day 2 not over yet: in no denominator
    const r = learnerReturn(l);
    for (const [group, fn] of Object.entries(GROUPS)) {
      const value = fn(l, r);
      const key = `${group}\u0000${value}`;
      const row = rows.get(key) ?? { group, value, n_day2: 0, returned_day2: 0, n_week1: 0, returned_week1: 0, answered_day0: 0, ten_day0: 0, avg_active_days_week1: null, activeSum: 0 };
      row.n_day2++;
      if (r.returnedDay2) row.returned_day2++;
      if (r.answersDay0 > 0) row.answered_day0++;
      if (r.answersDay0 >= 10) row.ten_day0++;
      if (age >= 8) {
        row.n_week1++;
        if (r.returnedWeek1) row.returned_week1++;
        row.activeSum += r.activeDaysWeek1;
      }
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .map(({ activeSum, ...row }) => ({ ...row, avg_active_days_week1: row.n_week1 > 0 ? Math.round((activeSum / row.n_week1) * 100) / 100 : null }))
    .sort((a, b) => RETURN_GROUPS.indexOf(a.group) - RETURN_GROUPS.indexOf(b.group) || a.value.localeCompare(b.value));
}
