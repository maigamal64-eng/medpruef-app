/**
 * Weekly accuracy and volume (LX-09-R). Pure: the route (draft in handover)
 * loads the learner's own answer_history rows for the last 12 weeks and this
 * groups them, so the page never fetches 50,000 rows client side.
 */
import { t } from "../i18n";
import { localDayKey } from "./due-summary";

export const WEEKS_SHOWN = 12;
const DAY_MS = 86_400_000;

export interface AnswerRow {
  createdAt: string;
  isCorrect: boolean;
}

export interface WeekBucket {
  /** Monday of the ISO week, YYYY-MM-DD in the learner's time zone. */
  weekStart: string;
  answered: number;
  correct: number;
  /** correct / answered, or null when nothing was answered. */
  accuracy: number | null;
}

function dayNumber(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
}

function mondayOf(key: string): number {
  const n = dayNumber(key);
  // 1970-01-01 was a Thursday: (n + 3) % 7 is 0 on Monday.
  return n - ((((n + 3) % 7) + 7) % 7);
}

export function buildWeeklyProgress(
  rows: readonly AnswerRow[],
  opts: { now: Date; timeZone?: string; weeks?: number },
): WeekBucket[] {
  const weeks = opts.weeks ?? WEEKS_SHOWN;
  const thisMonday = mondayOf(localDayKey(opts.now, opts.timeZone));
  const buckets: WeekBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisMonday - i * 7;
    buckets.push({
      weekStart: new Date(start * DAY_MS).toISOString().slice(0, 10),
      answered: 0,
      correct: 0,
      accuracy: null,
    });
  }
  const first = thisMonday - (weeks - 1) * 7;
  for (const r of rows) {
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t) || t > opts.now.getTime()) continue;
    const m = mondayOf(localDayKey(new Date(t), opts.timeZone));
    if (m < first || m > thisMonday) continue;
    const b = buckets[(m - first) / 7];
    b.answered += 1;
    if (r.isCorrect) b.correct += 1;
  }
  for (const b of buckets) b.accuracy = b.answered === 0 ? null : b.correct / b.answered;
  return buckets;
}

/** Header subtitle: "Noch 34 Tage bis zum 13. November" (date text is passed in, never typed here). */
export function countdownCopy(daysLeft: number, dateLabel: string, lang: "de" | "en"): string {
  if (daysLeft < 0) return t("a12_countdown_past", lang);
  if (daysLeft === 0) return t("a12_countdown_today", lang).replace("{date}", dateLabel);
  return t(daysLeft === 1 ? "a12_countdown_one" : "a12_countdown_days", lang).replace("{n}", String(daysLeft)).replace("{date}", dateLabel);
}
