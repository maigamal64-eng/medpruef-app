/**
 * OPEN_ANSWER_SELF_GRADE_ENABLED (a-open-answer-fix-1123, default OFF): after
 * "Antwort anzeigen" on a question without choices the learner may tap
 * "Gewusst" or "Nicht gewusst", which records the answer. Only the literal
 * "true" turns it on; runtime env, reported to the client by /api/auth/me so
 * no client asks anything while it is off. Pure.
 */
type Env = Record<string, string | undefined>;

export function openAnswerSelfGradeEnabled(env: Env = process.env): boolean {
  return env.OPEN_ANSWER_SELF_GRADE_ENABLED === "true";
}
