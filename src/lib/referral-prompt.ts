/**
 * Referral prompt for paying learners (a-referral-prompt-1029). Pure, client-safe.
 *
 * Behind REFERRAL_PROMPT_ENABLED (server env, default OFF, only the literal
 * "true"). A paying learner in the referral program (users.referrals_enabled)
 * gets one Home card asking them to share MedPrüf with a colleague preparing
 * for the same exam, only at a good moment and never on the quiz screen:
 *   - "strong_session": their latest study session (answers less than 30
 *     minutes apart) ended at least 10 minutes ago, within the last 24 hours,
 *     with 15+ answers at 80 percent or better;
 *   - "fixed_mistakes": in that session they answered 3+ questions correctly
 *     that they had answered wrongly before (inside the 30-day read).
 * At most once per 14 days (user_events referral_prompt_shown, any device) and
 * dismissible for good (referral_prompt_dismissed). It uses the existing
 * personal referral link and invite text (referral-copy.ts); the card itself
 * names no reward. The invite text states the exam reward in the first person,
 * so like the other referral surfaces it needs REFERRAL_EXAM_REWARD_ENABLED.
 */

export const REFERRAL_PROMPT_ENV = "REFERRAL_PROMPT_ENABLED";
export const REFERRAL_PROMPT_SHOWN_EVENT = "referral_prompt_shown";
export const REFERRAL_PROMPT_DISMISSED_EVENT = "referral_prompt_dismissed";

export const REFERRAL_PROMPT_INTERVAL_MS = 14 * 86_400_000;
/** Answers read for the moment: 30 days, newest first. */
export const REFERRAL_PROMPT_READ_DAYS = 30;
export const REFERRAL_PROMPT_ROW_CAP = 1500;
/** A gap this long between two answers ends a session. */
export const SESSION_GAP_MS = 30 * 60_000;
/** The session must have ended this long ago (the learner left the quiz). */
export const SESSION_SETTLED_MS = 10 * 60_000;
/** Only a session that ended within this window is a "moment". */
export const MOMENT_WINDOW_MS = 24 * 3_600_000;
export const STRONG_MIN_ANSWERS = 15;
export const STRONG_MIN_ACCURACY = 0.8;
export const FIXED_MIN_QUESTIONS = 3;

export type ReferralMoment = "strong_session" | "fixed_mistakes";
export type ReferralPromptReason = "dismissed" | "shown_recently" | "no_moment";

type Env = Record<string, string | undefined>;

/** Strict: only the literal "true" is on. */
export function referralPromptFlag(env: Env): boolean {
  return (env[REFERRAL_PROMPT_ENV] ?? "").trim() === "true";
}

/** The account-level switch /api/auth/me reports (paid access is checked by the client and the route). */
export function referralPromptEnabled(input: { flag: boolean; referralsEnabled: boolean; examRewardEnabled: boolean }): boolean {
  return input.flag && input.referralsEnabled && input.examRewardEnabled;
}

export interface AnswerRow {
  question_id: number | null;
  is_correct: boolean | null;
  created_at: string;
}

/**
 * The moment of the learner's latest session, or null. `rows` may come in any
 * order; rows with an unreadable date are ignored.
 */
export function referralMoment(rows: readonly AnswerRow[], now: Date): ReferralMoment | null {
  const nowMs = now.getTime();
  const sorted = rows
    .map((r) => ({ ...r, t: Date.parse(r.created_at) }))
    .filter((r) => Number.isFinite(r.t) && r.t <= nowMs)
    .sort((a, b) => b.t - a.t);
  if (sorted.length === 0) return null;
  const lastAt = sorted[0].t;
  if (nowMs - lastAt < SESSION_SETTLED_MS) return null;
  if (nowMs - lastAt > MOMENT_WINDOW_MS) return null;

  let end = 1;
  while (end < sorted.length && sorted[end - 1].t - sorted[end].t < SESSION_GAP_MS) end += 1;
  const session = sorted.slice(0, end);
  const before = sorted.slice(end);

  // Fixed mistakes: a question answered correctly in this session whose most
  // recent earlier answer (before this session) was wrong.
  const lastBefore = new Map<number, boolean>();
  for (const r of before) {
    if (r.question_id === null || r.is_correct === null) continue;
    if (!lastBefore.has(r.question_id)) lastBefore.set(r.question_id, r.is_correct);
  }
  const fixed = new Set<number>();
  for (const r of session) {
    if (r.question_id !== null && r.is_correct === true && lastBefore.get(r.question_id) === false) fixed.add(r.question_id);
  }
  if (fixed.size >= FIXED_MIN_QUESTIONS) return "fixed_mistakes";

  const graded = session.filter((r) => r.is_correct !== null);
  const correct = graded.filter((r) => r.is_correct === true).length;
  if (graded.length >= STRONG_MIN_ANSWERS && correct / graded.length >= STRONG_MIN_ACCURACY) return "strong_session";
  return null;
}

/** Cadence: dismissed for good wins; then one showing per 14 days. */
export function referralPromptCadence(input: { dismissed: boolean; lastShownAt: string | null; now: Date }): Exclude<ReferralPromptReason, "no_moment"> | null {
  if (input.dismissed) return "dismissed";
  if (input.lastShownAt) {
    const t = Date.parse(input.lastShownAt);
    if (Number.isFinite(t) && input.now.getTime() - t < REFERRAL_PROMPT_INTERVAL_MS) return "shown_recently";
  }
  return null;
}

export function shownWindowStart(now: Date): Date {
  return new Date(now.getTime() - REFERRAL_PROMPT_INTERVAL_MS);
}
