/**
 * Home study snapshot (UX-HOME-09, LX-10, UX-HOME-20). Pure: the server
 * loader (home-study-server.ts) reads the learner's own rows and these
 * functions decide what Home may show. The client never derives a streak or
 * today's count on its own: the answer RPC writes user_gamification on
 * Vienna days (20260925190000_atomic_quiz_answer.sql), so "today" and
 * "yesterday" here are Vienna calendar days too.
 */

export const STUDY_TIME_ZONE = "Europe/Vienna";
const DAY_MS = 86_400_000;

/** YYYY-MM-DD of `now` in Vienna (the same day the answer RPC writes). */
export function viennaDay(now: Date, timeZone: string = STUDY_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftDay(day: string, delta: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + delta * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

/**
 * The streak as of today. The stored current_streak only moves when an
 * answer is written, so a learner who stopped two days ago still has the old
 * value in the row. The server confirms the pause here (no answer today or
 * yesterday), so the client never invents a reset.
 */
export function effectiveStreak(currentStreak: number | null | undefined, lastStudyDate: string | null | undefined, today: string): number {
  const streak = Math.max(0, Number(currentStreak) || 0);
  if (!isDay(lastStudyDate)) return 0;
  const last = lastStudyDate.slice(0, 10);
  return last === today || last === shiftDay(today, -1) ? streak : 0;
}

/** Answers today: the stored counter only belongs to the day it was reset on. */
export function answersToday(dailyCount: number | null | undefined, resetDate: string | null | undefined, today: string): number {
  if (!isDay(resetDate) || resetDate.slice(0, 10) !== today) return 0;
  return Math.max(0, Number(dailyCount) || 0);
}

/** Distinct Vienna days with at least one answer in the last 7 days (today included). */
export function activeDaysLast7(answerTimes: readonly string[], now: Date, timeZone: string = STUDY_TIME_ZONE): number {
  return activeDaysInWindow(answerTimes, now, 7, timeZone);
}

/** Distinct Vienna days with an answer in the last `days` days, today included. */
export function activeDaysInWindow(answerTimes: readonly string[], now: Date, days: number, timeZone: string = STUDY_TIME_ZONE): number {
  const today = viennaDay(now, timeZone);
  const first = shiftDay(today, -(Math.max(1, Math.floor(days)) - 1));
  const seen = new Set<string>();
  for (const at of answerTimes) {
    const t = Date.parse(at);
    if (Number.isNaN(t) || t > now.getTime()) continue;
    const day = viennaDay(new Date(t), timeZone);
    if (day >= first && day <= today) seen.add(day);
  }
  return seen.size;
}

/** Trefferquote for the active exam: correct over all answers, null without answers. */
export function hitRatePct(correct: number, answered: number): number | null {
  return answered > 0 ? Math.round((Math.max(0, correct) / answered) * 100) : null;
}

/**
 * Learner phase for Home (UX-HOME-20): new (no answer yet), returning (last
 * answer 1 to 7 days ago), lapsed (more than 7 days ago) or active (today).
 */
export type StudyPhase = "new" | "active" | "returning" | "lapsed";
export function studyPhase(totalAnswered: number, lastStudyDate: string | null | undefined, today: string): StudyPhase {
  if (!(totalAnswered > 0) || !isDay(lastStudyDate)) return "new";
  const gap = daysBetween(lastStudyDate.slice(0, 10), today);
  if (gap <= 0) return "active";
  return gap <= 7 ? "returning" : "lapsed";
}

/** The snapshot `/api/auth/me?include=study` returns. Every field is server-owned. */
export interface StudySnapshot {
  /** Vienna day the counts belong to. */
  day: string;
  streak: number;
  answersToday: number;
  dailyGoal: number;
  activeDays7: number;
  totalAnswered: number;
  lastStudyDate: string | null;
  daysSinceStudy: number | null;
  phase: StudyPhase;
  activeExam: string | null;
  examDate: string | null;
  /** Trefferquote on the active exam (attempts), null without answers. */
  hitRate: number | null;
}

/** Runtime check for the cached or fetched snapshot. */
export function isStudySnapshot(v: unknown): v is StudySnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
  const numOrNull = (x: unknown) => x === null || num(x);
  return isDay(s.day) && num(s.streak) && num(s.answersToday) && num(s.dailyGoal) && num(s.activeDays7)
    && num(s.totalAnswered) && (s.lastStudyDate === null || isDay(s.lastStudyDate))
    && numOrNull(s.daysSinceStudy) && ["new", "active", "returning", "lapsed"].includes(s.phase as string)
    && (s.activeExam === null || typeof s.activeExam === "string")
    && (s.examDate === null || typeof s.examDate === "string")
    && numOrNull(s.hitRate);
}
