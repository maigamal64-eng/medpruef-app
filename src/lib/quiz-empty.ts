/**
 * quiz_empty reason (a-open-answer-fix-1123). An empty unseen draw with an exam
 * year, tags or a narrowing filter is a filter result, not exhaustion: logging
 * it as all_seen hid the pharma exam-year empties. The learner watch and
 * stall-watch keep reading all_seen; "filtered" is new. Pure.
 */
export interface QuizEmptyScope {
  examYear?: string | null;
  tags?: readonly string[] | null;
  filter?: string | null;
}

/** "unused" is the unseen draw itself, so it stays all_seen; incorrect and flagged narrow it. */
export function isNarrowedDraw(scope: QuizEmptyScope): boolean {
  return Boolean(scope.examYear) || (scope.tags?.length ?? 0) > 0 || (Boolean(scope.filter) && scope.filter !== "all" && scope.filter !== "unused");
}

export function quizEmptyReason(mode: string, scope: QuizEmptyScope): "all_seen" | "filtered" | "other" {
  if (mode !== "unseen") return "other";
  return isNarrowedDraw(scope) ? "filtered" : "all_seen";
}
