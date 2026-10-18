/**
 * Feedback ask at a natural pause (a-feedback-at-pause, 2026-10-17).
 *
 * One short optional question on the quiz round-end card after a finished
 * set. Never a modal, never during a quiz. Pure rules here; the route
 * (`/api/feedback/ask`) reads the inputs and the round-end card renders.
 *
 *  - At most one ask per learner per 14 days, across every surface: the
 *    in-app card and the learner-watch mail asks share the user_events row
 *    `feedback_ask_shown` {surface, source}. Any row in the window blocks,
 *    whatever its surface or source.
 *  - Never in the learner's own sitting week (journey M5, isSittingWeek over
 *    the named sitting from users.exam_date / active_exam). Computed on the
 *    server from OFFICIAL_SITTINGS, independent of MOMENTS_ENABLED.
 *  - The client also waits while another announcement surface is elected
 *    (useAnnouncementGate) and asks the announcement queue for its slot.
 *
 * Flag FEEDBACK_ASK_ENABLED (server, default OFF; only the literal "true").
 */
import { resolveNamedSitting, isSittingWeek, type LearnerInput } from "@/lib/journey/moments";
import { OFFICIAL_SITTINGS, type OfficialSitting } from "@/lib/exam-dates";

type Env = Record<string, string | undefined>;

export const FEEDBACK_ASK_ENV = "FEEDBACK_ASK_ENABLED";
/** user_events.event_type of every ask shown (in app or by mail). */
export const FEEDBACK_ASK_SHOWN_EVENT = "feedback_ask_shown";
/** user_feedback.context.source of an answer to the round-end ask. */
export const ROUND_END_ASK_SOURCE = "round_end_ask";
/** At most one ask per learner in this many days. */
export const FEEDBACK_ASK_COOLDOWN_DAYS = 14;
const DAY_MS = 86_400_000;

/** The in-app surface and its source on the feedback_ask_shown row. */
export const ROUND_END_SURFACE = "round_end";
export const QUIZ_SOURCE = "quiz";

export function feedbackAskEnabled(env: Env = process.env): boolean {
  return env[FEEDBACK_ASK_ENV] === "true";
}

/** Start of the cooldown window: rows created at or after this instant block. */
export function cooldownStart(now: Date): Date {
  return new Date(now.getTime() - FEEDBACK_ASK_COOLDOWN_DAYS * DAY_MS);
}

export type FeedbackAskReason = "ok" | "asked_recently" | "sitting_week";

export interface FeedbackAskInput {
  /** Newest feedback_ask_shown row of this learner (any surface), or null. */
  lastShownAt: string | null;
  /** users.exam_date and active_exam (the journey engine names the sitting from them). */
  learner: Pick<LearnerInput, "examDate" | "activeExam">;
  now: Date;
}

/** True when `now` is in the Vienna week(s) of the learner's own named sitting. */
export function inOwnSittingWeek(
  learner: Pick<LearnerInput, "examDate" | "activeExam">,
  now: Date,
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): boolean {
  return isSittingWeek(resolveNamedSitting({ examDate: learner.examDate, activeExam: learner.activeExam }, now, sittings), now);
}

/** True while an ask shown at `lastShownAt` still blocks a new one. An unreadable stamp blocks (fail quiet). */
export function askedRecently(lastShownAt: string | null, now: Date): boolean {
  if (!lastShownAt) return false;
  const at = Date.parse(lastShownAt);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at < FEEDBACK_ASK_COOLDOWN_DAYS * DAY_MS;
}

export function decideFeedbackAsk(
  input: FeedbackAskInput,
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): FeedbackAskReason {
  if (inOwnSittingWeek(input.learner, input.now, sittings)) return "sitting_week";
  if (askedRecently(input.lastShownAt, input.now)) return "asked_recently";
  return "ok";
}

/**
 * The round-end card may ask only after a finished set: the round reached
 * its target (not a timer cut or an empty pool) and at least 3 answers were
 * graded. A starter round's end belongs to the first-win block.
 */
export function roundQualifies(r: { graded: number; targetCount: number; questionCount: number; starterFirstWin: boolean }): boolean {
  if (r.starterFirstWin) return false;
  if (!Number.isFinite(r.graded) || r.graded < 3) return false;
  return r.questionCount >= r.targetCount;
}
