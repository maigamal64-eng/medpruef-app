/**
 * Experience reward program (a-rewards-program, plan.json J10; reports/
 * ai-credits-2026-10-14). Pure config and timing rules, server and client
 * safe (no I/O). The ledger side lives in src/lib/mentor/credits/rewards.ts.
 *
 * Three thank-yous in AI Mentor credits, each behind its own flag, default OFF:
 *
 *   testimonial   MENTOR_EXPERIENCE_REWARD_ENABLED (a-free-credit-hooks L5,
 *                 100 credits once per person, admin approved). Unchanged;
 *                 it now grants through the shared helper.
 *   exam report   REWARDS_EXAM_REPORT_ENABLED: 150 credits once per official
 *                 sitting per person for a first-party report on how the
 *                 sitting went. Prompted only after the sitting's last day and
 *                 never during an official sitting week; an admin approves the
 *                 grant (spam check only), never the opinion.
 *   applied fix   REWARDS_FIX_ENABLED: 10 credits when an admin confirms a
 *                 question report as fixed (an applied edit or the outcome
 *                 "fixed"); at most 100 credits per learner per Vienna month;
 *                 clawed back when the edit is reverted or the decision undone.
 *
 * Never for public platform reviews (Google, Trustpilot, app stores): those
 * platforms forbid incentives, and nothing here links to or mentions them.
 * A reward never depends on sentiment, rating or length, and is never granted
 * by a submission alone: an admin decision always comes first.
 */

import { OFFICIAL_SITTINGS, type OfficialSitting } from "./exam-dates";

type Env = Record<string, string | undefined>;

export const REWARD_DEFAULTS = Object.freeze({
  examReportCredits: 150,
  examReportExpiryDays: 60,
  /** Breaker: exam report grants per Vienna month across all accounts. */
  examReportMonthlyCap: 300,
  /** Days after a sitting's last day in which the report card is offered and accepted. */
  examReportWindowDays: 30,
  fixCredits: 10,
  fixExpiryDays: 60,
  /** Per learner per Vienna month (plan J10: 10 fixes). */
  fixMonthlyCreditCap: 100,
});

export const REWARD_ENV = Object.freeze({
  examReport: "REWARDS_EXAM_REPORT_ENABLED",
  examReportCredits: "REWARDS_EXAM_REPORT_CREDITS",
  examReportExpiryDays: "REWARDS_EXAM_REPORT_EXPIRY_DAYS",
  examReportMonthlyCap: "REWARDS_EXAM_REPORT_MONTHLY_CAP",
  fix: "REWARDS_FIX_ENABLED",
  fixCredits: "REWARDS_FIX_CREDITS",
  fixExpiryDays: "REWARDS_FIX_EXPIRY_DAYS",
  fixMonthlyCreditCap: "REWARDS_FIX_MONTHLY_CREDIT_CAP",
} as const);

export interface RewardConfig {
  examReportEnabled: boolean;
  examReportCredits: number;
  examReportExpiryDays: number;
  examReportMonthlyCap: number;
  fixEnabled: boolean;
  fixCredits: number;
  fixExpiryDays: number;
  fixMonthlyCreditCap: number;
}

function on(raw: string | undefined): boolean {
  return (raw ?? "").trim() === "true";
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function readRewardConfig(env: Env = process.env): RewardConfig {
  const d = REWARD_DEFAULTS;
  return {
    examReportEnabled: on(env[REWARD_ENV.examReport]),
    examReportCredits: int(env[REWARD_ENV.examReportCredits], d.examReportCredits, 1, 1000),
    examReportExpiryDays: int(env[REWARD_ENV.examReportExpiryDays], d.examReportExpiryDays, 1, 180),
    examReportMonthlyCap: int(env[REWARD_ENV.examReportMonthlyCap], d.examReportMonthlyCap, 0, 10_000),
    fixEnabled: on(env[REWARD_ENV.fix]),
    fixCredits: int(env[REWARD_ENV.fixCredits], d.fixCredits, 1, 100),
    fixExpiryDays: int(env[REWARD_ENV.fixExpiryDays], d.fixExpiryDays, 1, 180),
    fixMonthlyCreditCap: int(env[REWARD_ENV.fixMonthlyCreditCap], d.fixMonthlyCreditCap, 0, 1000),
  };
}

// ─── Exam report timing ────────────────────────────────────────────────

/**
 * Days on which the report card is never offered (plan J10): the November
 * 2026 SIP days with their two following days and the Rezeptierkunde /
 * Gerichtsmedizin exam week. Every official sitting day is blocked as well
 * (examReportBlocked), so later sittings need no entry here.
 */
export const EXAM_REPORT_BLACKOUT: ReadonlyArray<readonly [string, string]> = [
  ["2026-11-17", "2026-11-20"],
  ["2026-11-23", "2026-11-27"],
];

/** Europe/Vienna calendar day of `now` as YYYY-MM-DD. */
export function viennaDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(day: string, n: number): string {
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** One reportable sitting: the exam and its (first) date, whatever the publisher. */
export interface ReportableSitting {
  /** `<exam_key>:<date>`, the reward key part. */
  key: string;
  exam_key: OfficialSitting["exam_key"];
  date: string;
  last_day: string;
  label: { de: string; en: string };
}

const SITTING_KEY_RE = /^[a-z0-9]{2,20}:\d{4}-\d{2}-\d{2}$/;

export function sittingKey(s: Pick<OfficialSitting, "exam_key" | "date">): string {
  return `${s.exam_key}:${s.date}`;
}

/** The official sittings as reportable units (the Stichprobentest has one row per publisher). */
export function reportableSittings(rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): ReportableSitting[] {
  const out = new Map<string, ReportableSitting>();
  for (const r of rows) {
    const key = sittingKey(r);
    if (!out.has(key)) out.set(key, { key, exam_key: r.exam_key, date: r.date, last_day: r.date_end ?? r.date, label: r.learner_label });
  }
  return [...out.values()];
}

/** A sitting day of any official sitting, or an explicit blackout window. */
export function examReportBlocked(day: string, rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): boolean {
  if (EXAM_REPORT_BLACKOUT.some(([a, b]) => day >= a && day <= b)) return true;
  return rows.some((r) => day >= r.date && day <= (r.date_end ?? r.date));
}

/**
 * Sittings a report may be sent for on `now`: the last day has passed and at
 * most `windowDays` days ago. Ignores the blackout (a card opened before a
 * blackout day may still be sent); the prompt uses examReportPromptSittings.
 */
export function openReportSittings(now: Date, windowDays: number = REWARD_DEFAULTS.examReportWindowDays, rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): ReportableSitting[] {
  const today = viennaDay(now);
  return reportableSittings(rows)
    .filter((s) => today > s.last_day && today <= addDays(s.last_day, windowDays))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.key.localeCompare(b.key)));
}

/** Sittings the Settings card offers today: open ones, none on a blocked day. */
export function examReportPromptSittings(now: Date, windowDays: number = REWARD_DEFAULTS.examReportWindowDays, rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): ReportableSitting[] {
  if (examReportBlocked(viennaDay(now), rows)) return [];
  return openReportSittings(now, windowDays, rows);
}

/** The sitting a key names, if it is an official sitting whose last day has passed. */
export function pastSittingByKey(key: unknown, now: Date, rows: readonly OfficialSitting[] = OFFICIAL_SITTINGS): ReportableSitting | null {
  if (typeof key !== "string" || !SITTING_KEY_RE.test(key)) return null;
  const s = reportableSittings(rows).find((r) => r.key === key);
  return s && viennaDay(now) > s.last_day ? s : null;
}
