/**
 * "N due today" summary (LX-06-R). Pure: cap, rest, bucket by the learner's
 * local day. The route (draft in handover) loads user_question_progress rows
 * scoped to the active exam and active questions and passes them here.
 *
 * Free or non-entitled callers get { entitled: false } and no counts.
 */
import { t } from "../i18n";


export const DUE_ROUND_CAP = 20;
const DAY_MS = 86_400_000;

export interface DueRow {
  questionId: number;
  nextReviewAt: string | null;
  ease: number | null;
}

export type DueSummary =
  | { entitled: false }
  | {
      entitled: true;
      /** Everything due by the end of the learner's local day (overdue included). */
      dueToday: number;
      /** Due before the start of the local day. */
      overdue: number;
      /** Reviews due on each of the next 7 local days, tomorrow first. */
      next7: number[];
      cap: number;
      /** min(dueToday, cap): size of the due-first round. */
      capped: number;
      remaining: number;
    };

/** YYYY-MM-DD of an instant in an IANA time zone (default Europe/Vienna). */
export function localDayKey(at: Date, timeZone = "Europe/Vienna"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function dayNumber(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
}

export function buildDueSummary(
  rows: readonly DueRow[],
  opts: { now: Date; timeZone?: string; entitled: boolean; cap?: number },
): DueSummary {
  if (!opts.entitled) return { entitled: false };
  const cap = opts.cap ?? DUE_ROUND_CAP;
  const today = dayNumber(localDayKey(opts.now, opts.timeZone));
  let dueToday = 0;
  let overdue = 0;
  const next7 = [0, 0, 0, 0, 0, 0, 0];
  for (const r of rows) {
    if (!r.nextReviewAt) continue;
    const t = Date.parse(r.nextReviewAt);
    if (Number.isNaN(t)) continue;
    const d = dayNumber(localDayKey(new Date(t), opts.timeZone));
    if (d <= today) {
      dueToday += 1;
      if (d < today) overdue += 1;
    } else if (d - today <= 7) {
      next7[d - today - 1] += 1;
    }
  }
  const capped = Math.min(dueToday, cap);
  return { entitled: true, dueToday, overdue, next7, cap, capped, remaining: dueToday - capped };
}

/** Overdue-ness first (oldest due first), then lowest ease (PRA-13 rule 3), then id. */
export function orderDueRows<T extends DueRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = a.nextReviewAt ? Date.parse(a.nextReviewAt) : Number.POSITIVE_INFINITY;
    const tb = b.nextReviewAt ? Date.parse(b.nextReviewAt) : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    const ea = a.ease ?? 2.5;
    const eb = b.ease ?? 2.5;
    if (ea !== eb) return ea - eb;
    return a.questionId - b.questionId;
  });
}

/** The round the "Heute fällig" button opens: first `cap` rows in due order. */
export function dueRound<T extends DueRow>(rows: readonly T[], now: Date, cap = DUE_ROUND_CAP, timeZone?: string): T[] {
  const today = dayNumber(localDayKey(now, timeZone));
  const due = rows.filter((r) => {
    if (!r.nextReviewAt) return false;
    const t = Date.parse(r.nextReviewAt);
    return !Number.isNaN(t) && dayNumber(localDayKey(new Date(t), timeZone)) <= today;
  });
  return orderDueRows(due).slice(0, cap);
}

/** Text, not colour. Nothing for a non-entitled summary. */
export function dueCopy(summary: DueSummary, lang: "de" | "en"): string | null {
  if (!summary.entitled) return null;
  if (summary.dueToday > 0) {
    return t("a12_due_today", lang).replace("{n}", String(summary.dueToday));
  }
  const next = summary.next7.findIndex((n) => n > 0);
  if (next === -1) {
    return t("a12_due_none", lang);
  }
  const n = summary.next7[next];
  const when = next === 0 ? t("a12_due_next_tomorrow", lang) : t("a12_due_next_days", lang).replace("{n}", String(next + 1));
  const nextLabel = { de: "Nächste Wiederholung", en: "Next review" }[lang];
  return `${t("a12_due_none", lang)} ${nextLabel}: ${when} (${n}).`;
}
