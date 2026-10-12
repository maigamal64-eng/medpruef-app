/**
 * Spaced-repetition arithmetic that says what the app really does (LX-05-R).
 * Pure. Two schedulers live here on purpose:
 *
 *  1. binaryNext: byte-for-byte the arithmetic of record_quiz_answer
 *     (supabase/migrations/20260925190000_atomic_quiz_answer.sql L56-76) and of
 *     /api/notes/[id]/review. Questions and flashcards only record right or
 *     wrong today, so the honest name is "interval x ease", not SM-2
 *     (decision pick-scheduler, option A).
 *  2. gradedNext: the four-grade scheduler for step 2 (migration
 *     20261222090000_a23_graded_review.sql, flag SRS_GRADE_ENABLED, default OFF).
 *     The SQL function srs_graded_next mirrors it; srs.test.ts pins a golden
 *     table and the local Postgres proof compares the two.
 *
 * Decision pick-interval-limits (option A): new intervals are capped at
 * MAX_INTERVAL_DAYS and the next review never falls later than the exam date
 * minus EXAM_BUFFER_DAYS. Old rows above the cap are reported separately
 * (isLegacyExtremeInterval), never rewritten silently.
 *
 * Rounding is half-to-even to match PostgreSQL round(double precision).
 */
import { t } from "../i18n";


export const MAX_INTERVAL_DAYS = 180;
export const EXAM_BUFFER_DAYS = 2;
export const EASE_FLOOR = 1.3;
export const EASE_CAP = 3.0;
export const DEFAULT_EASE = 2.5;

export type Grade = 0 | 1 | 2 | 3;
export const GRADE_NAMES = ["again", "hard", "good", "easy"] as const;
export type GradeName = (typeof GRADE_NAMES)[number];

export interface SrsState {
  /** user_question_progress.ease_factor (null on a new card). */
  ease: number | null;
  /** user_question_progress.interval_days (null on a new card). */
  intervalDays: number | null;
}

export interface SrsResult {
  ease: number;
  intervalDays: number;
  /** Which limit shortened the interval, if any. */
  cappedBy: "max_interval" | "exam_date" | null;
}

/** PostgreSQL round(double precision) is rint(): ties go to the even integer. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

/**
 * Longest allowed interval so that the review lands by exam_date minus the
 * buffer. An exam date in the past never caps (a stale users.exam_date would
 * otherwise make every card due at once); srs_cap_interval in
 * 20261222090000_a23_graded_review.sql applies the same rule.
 */
export function examCapDays(todayIso: string, examDateIso: string | null | undefined): number | null {
  if (!examDateIso) return null;
  const left = dayNumber(examDateIso) - dayNumber(todayIso);
  if (left < 0) return null;
  return Math.max(0, left - EXAM_BUFFER_DAYS);
}

function applyCaps(raw: number, todayIso: string | undefined, examDateIso: string | null | undefined): { days: number; cappedBy: SrsResult["cappedBy"] } {
  let days = raw;
  let cappedBy: SrsResult["cappedBy"] = null;
  if (days > MAX_INTERVAL_DAYS) {
    days = MAX_INTERVAL_DAYS;
    cappedBy = "max_interval";
  }
  if (todayIso) {
    const cap = examCapDays(todayIso, examDateIso);
    if (cap !== null && days > cap) {
      days = cap;
      cappedBy = "exam_date";
    }
  }
  return { days, cappedBy };
}

/* ── 1. Binary scheduler (what runs today) ─────────────────────────── */

/**
 * Mirror of the record_quiz_answer progress upsert. Without `opts` it is the
 * uncapped 20260925190000 arithmetic; with `opts` it applies the caps that the
 * a23 changeset adds (180 days, exam date minus 2, past exams ignored).
 */
export function binaryNext(
  prior: SrsState | null,
  correct: boolean,
  opts?: { todayIso?: string; examDate?: string | null },
): SrsResult {
  let ease: number;
  let raw: number;
  if (!prior || (prior.ease === null && prior.intervalDays === null)) {
    ease = correct ? 2.6 : 2.3;
    raw = correct ? 1 : 0;
  } else {
    const ease0 = prior.ease ?? DEFAULT_EASE;
    const prev = prior.intervalDays ?? 0;
    ease = correct ? Math.min(EASE_CAP, ease0 + 0.1) : Math.max(EASE_FLOOR, ease0 - 0.2);
    raw = correct ? Math.max(1, roundHalfEven(prev * ease)) : 0;
  }
  if (!opts) return { ease, intervalDays: raw, cappedBy: null };
  const { days, cappedBy } = applyCaps(raw, opts.todayIso, opts.examDate);
  return { ease, intervalDays: days, cappedBy };
}

/* ── 2. Graded scheduler (step 2, flag OFF) ────────────────────────── */

/** Step of the card: 0 new or lapsed, 1 first success (interval 1..5), 2 established. */
function stepOf(prevInterval: number): 0 | 1 | 2 {
  if (prevInterval <= 0) return 0;
  return prevInterval < 6 ? 1 : 2;
}

function goodInterval(prev: number, ease: number): number {
  const step = stepOf(prev);
  if (step === 0) return 1;
  if (step === 1) return 6;
  return Math.max(1, roundHalfEven(prev * ease));
}

export function gradedNext(
  prior: SrsState | null,
  grade: Grade,
  opts: { todayIso?: string; examDate?: string | null } = {},
): SrsResult {
  const ease0 = prior?.ease ?? DEFAULT_EASE;
  const prev = prior?.intervalDays ?? 0;
  let ease = ease0;
  let raw: number;
  switch (grade) {
    case 0:
      ease = Math.max(EASE_FLOOR, ease0 - 0.2);
      raw = 0;
      break;
    case 1:
      ease = Math.max(EASE_FLOOR, ease0 - 0.15);
      raw = stepOf(prev) === 0 ? 1 : Math.max(1, roundHalfEven(prev * 1.2));
      break;
    case 2:
      raw = goodInterval(prev, ease0);
      break;
    case 3: {
      ease = Math.min(EASE_CAP, ease0 + 0.15);
      const base = goodInterval(prev, ease);
      raw = Math.max(base + 1, roundHalfEven(base * 1.3));
      break;
    }
    default:
      throw new RangeError("grade must be 0..3");
  }
  const { days, cappedBy } = applyCaps(raw, opts.todayIso, opts.examDate);
  return { ease, intervalDays: days, cappedBy };
}

/** next_review_at the way the RPC stores it: now + interval_days days. */
export function nextReviewAt(now: Date, intervalDays: number): Date {
  return new Date(now.getTime() + intervalDays * DAY_MS);
}

/** Notes feature (note_review_progress) uses the same binary variant: good and easy count as right. */
export function gradeIsCorrect(grade: Grade): boolean {
  return grade >= 2;
}

/* ── Labels ────────────────────────────────────────────────────────── */

/** Learner-facing result of an interval, shown AFTER the tap from the stored value. */
export function intervalLabel(days: number, lang: "de" | "en"): string {
  if (days <= 0) return t("a12_interval_today", lang);
  if (days === 1) return t("a12_interval_tomorrow", lang);
  return t("a12_interval_days", lang).replace("{n}", String(days));
}

/** Preview per grade, so the button label equals the stored interval. */
export function previewGraded(
  prior: SrsState | null,
  lang: "de" | "en",
  opts: { todayIso?: string; examDate?: string | null } = {},
): Record<GradeName, { intervalDays: number; label: string }> {
  const out = {} as Record<GradeName, { intervalDays: number; label: string }>;
  ([0, 1, 2, 3] as const).forEach((g) => {
    const r = gradedNext(prior, g, opts);
    out[GRADE_NAMES[g]] = { intervalDays: r.intervalDays, label: intervalLabel(r.intervalDays, lang) };
  });
  return out;
}

/** Free accounts record right or wrong only (LX-05-R step 1). */
export const BINARY_BUTTON_LABELS = {
  de: { right: "Gewusst", wrong: "Nicht gewusst", proNote: "Wiederholungsplanung ist in Pro enthalten" },
  en: { right: "Knew it", wrong: "Did not know", proNote: "Review scheduling is included in Pro" },
} as const;

/** The claim that matches the behaviour until step 2 is live. */
export const SRS_CLAIM = {
  de: "Wiederholungsplanung (angelehnt an SM-2)",
  en: "Review scheduling (inspired by SM-2)",
} as const;

/** Old rows above the cap are reviewed separately, never rewritten here. */
export function isLegacyExtremeInterval(intervalDays: number | null | undefined): boolean {
  return typeof intervalDays === "number" && intervalDays > MAX_INTERVAL_DAYS;
}
