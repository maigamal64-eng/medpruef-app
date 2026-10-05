/** Keep question flashcard draws distinct within the current review session. */
export function rememberReviewedQuestion(ids: number[], questionId: number): number[] {
  if (!Number.isInteger(questionId) || questionId <= 0 || ids.includes(questionId)) return ids;
  return [...ids, questionId];
}

export function addExcludedQuestionIds(params: URLSearchParams, ids: number[]): URLSearchParams {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length) params.set("excludeIds", unique.join(","));
  else params.delete("excludeIds");
  return params;
}
