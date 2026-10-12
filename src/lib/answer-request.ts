/**
 * Which recorder an /api/answer request uses (a23 practice). Pure, server-safe.
 *
 * Three server flags, all default OFF, so a request without them behaves as
 * before the a23 changeset (20261222090000) and never calls an RPC that the
 * production database does not have yet:
 *
 *  - SRS_GRADE_ENABLED            a 0..3 grade schedules with the graded
 *                                 scheduler (pick-scheduler A, LX-05 step 2).
 *  - FLASHCARD_REVIEW_KIND_ENABLED  kind "flashcard" is its own record: schedule
 *                                 and review log only, no XP, accuracy, free-cap
 *                                 count or mistake entry (pick-ux-pra-59 A).
 *  - FREE_SCHEDULE_ENABLED        free accounts' answers also write the schedule;
 *                                 review surfaces stay Pro (pick-ux-pra-85 A).
 */
export type AnswerKind = "quiz" | "flashcard";
export type AnswerGrade = 0 | 1 | 2 | 3;
export type AnswerPath = "quiz" | "graded" | "flashcard";

export interface AnswerFlags {
  srsGrade: boolean;
  flashcardKind: boolean;
  freeSchedule: boolean;
}

export function readAnswerFlags(env: Record<string, string | undefined>): AnswerFlags {
  return {
    srsGrade: env.SRS_GRADE_ENABLED === "true",
    flashcardKind: env.FLASHCARD_REVIEW_KIND_ENABLED === "true",
    freeSchedule: env.FREE_SCHEDULE_ENABLED === "true",
  };
}

/** undefined = not sent; null = sent but invalid. */
export function parseGrade(value: unknown): AnswerGrade | undefined | null {
  if (value === undefined) return undefined;
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : null;
}

/** undefined = not sent (quiz); null = sent but invalid. */
export function parseKind(value: unknown): AnswerKind | undefined | null {
  if (value === undefined) return undefined;
  return value === "quiz" || value === "flashcard" ? value : null;
}

export function resolveAnswerPath(kind: AnswerKind | undefined, grade: AnswerGrade | undefined, flags: AnswerFlags): AnswerPath {
  if (kind === "flashcard" && flags.flashcardKind && grade !== undefined) return "flashcard";
  if (grade !== undefined && flags.srsGrade) return "graded";
  return "quiz";
}

/**
 * The RPC's p_is_free: true means "write no schedule". Free accounts get a
 * schedule only when FREE_SCHEDULE_ENABLED is on; the response still carries
 * no review promise for them (PRA-26/85).
 */
export function skipSchedule(isFreeUser: boolean, flags: AnswerFlags): boolean {
  return isFreeUser && !flags.freeSchedule;
}

/** Confidence button to grade: again 0, hard 1, good 2, easy 3. */
export const CONFIDENCE_GRADE = { again: 0, hard: 1, good: 2, easy: 3 } as const satisfies Record<string, AnswerGrade>;
