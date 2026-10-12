/**
 * Question report repeat counts and fix times (a19, TR-14, TR-11). Pure.
 *
 * Repeat (TR-14): computed at read time from question_suggestions, no new
 * table. A report is a repeat when its question has 2 or more reports in
 * total (any status); the chip reads "repeat (N)" with N the total.
 *
 * Fix times (TR-11, pick-support-time B, [name] 2026-10-11): reports are
 * acknowledged within 3 working days (a decision counts as the
 * acknowledgement; working days are Monday to Friday in Vienna, public
 * holidays not modelled). Internal target, not published: wrong-key
 * reports fixed within 7 days at the 90th percentile (168 hours).
 */

export const REPORT_ACK_WORKING_DAYS = 3;
export const WRONG_KEY_P90_TARGET_HOURS = 168;
export const WRONG_KEY_REASONS: ReadonlySet<string> = new Set(["incorrect_answer", "wrong_answer"]);

/** question_id -> total number of reports for it. */
export function repeatCounts(rows: ReadonlyArray<{ question_id: number | null }>): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    if (typeof r.question_id !== "number") continue;
    out.set(r.question_id, (out.get(r.question_id) ?? 0) + 1);
  }
  return out;
}

/** The chip count for one report: null below 2 (not a repeat). */
export function repeatOf(counts: ReadonlyMap<number, number>, questionId: number | null | undefined): number | null {
  if (typeof questionId !== "number") return null;
  const n = counts.get(questionId) ?? 0;
  return n >= 2 ? n : null;
}

/** TR-14: repeats first (most reports first), then newest, within a loaded page. */
export function orderRepeatsFirst<T extends { repeat_count?: number | null; created_at: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (b.repeat_count ?? 0) - (a.repeat_count ?? 0) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/** Nearest-rank percentile (p in 0..100) of an unsorted list; null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

const VIENNA_WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/Vienna" });
const VIENNA_DATE = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Vienna" });

function isViennaWeekend(ms: number): boolean {
  const d = VIENNA_WEEKDAY.format(new Date(ms));
  return d === "Sat" || d === "Sun";
}

/**
 * Whole Vienna working days elapsed after `fromIso` up to `toMs`: a report
 * sent on Friday afternoon and decided on Monday took 1 working day.
 */
export function workingDaysBetween(fromIso: string, toMs: number): number {
  const from = Date.parse(fromIso);
  if (!Number.isFinite(from) || toMs <= from) return 0;
  const endDay = VIENNA_DATE.format(new Date(toMs));
  let days = 0;
  // Step through calendar days at noon offsets to stay clear of DST edges.
  let cursor = from;
  let guard = 0;
  while (guard++ < 400) {
    cursor += 86_400_000;
    const day = VIENNA_DATE.format(new Date(cursor));
    if (day > endDay) break;
    if (!isViennaWeekend(cursor)) days += 1;
    if (day === endDay) break;
  }
  return days;
}

export interface ReportRow {
  reason: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

export interface ReportFixTimes {
  window_days: number;
  received: number;
  decided: number;
  median_hours: number | null;
  p90_hours: number | null;
  /** Decided within REPORT_ACK_WORKING_DAYS, of all decided. */
  acknowledged_on_time: number;
  /** Still open and older than REPORT_ACK_WORKING_DAYS working days. */
  open_over_target: number;
  wrong_key: { decided: number; p90_hours: number | null; target_hours: number; on_target: boolean | null };
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Rows created in the window (callers filter by created_at). */
export function computeReportFixTimes(rows: readonly ReportRow[], now: Date, windowDays = 90): ReportFixTimes {
  const hours: number[] = [];
  const wrongKeyHours: number[] = [];
  let onTime = 0;
  let openOver = 0;
  for (const r of rows) {
    const created = Date.parse(r.created_at);
    if (!Number.isFinite(created)) continue;
    const resolved = r.resolved_at ? Date.parse(r.resolved_at) : NaN;
    if (r.status !== "pending" && Number.isFinite(resolved) && resolved >= created) {
      const h = (resolved - created) / 3_600_000;
      hours.push(h);
      if (workingDaysBetween(r.created_at, resolved) <= REPORT_ACK_WORKING_DAYS) onTime += 1;
      if (r.reason && WRONG_KEY_REASONS.has(r.reason)) wrongKeyHours.push(h);
    } else if (r.status === "pending" && workingDaysBetween(r.created_at, now.getTime()) > REPORT_ACK_WORKING_DAYS) {
      openOver += 1;
    }
  }
  const wkP90 = round1(percentile(wrongKeyHours, 90));
  return {
    window_days: windowDays,
    received: rows.length,
    decided: hours.length,
    median_hours: round1(percentile(hours, 50)),
    p90_hours: round1(percentile(hours, 90)),
    acknowledged_on_time: onTime,
    open_over_target: openOver,
    wrong_key: { decided: wrongKeyHours.length, p90_hours: wkP90, target_hours: WRONG_KEY_P90_TARGET_HOURS, on_target: wkP90 == null ? null : wkP90 <= WRONG_KEY_P90_TARGET_HOURS },
  };
}
