/** Answer reveal for a free-recall question has no submitted response, so it
 * may advance the session but must not create a graded answer or XP event. */
export function isUnscoredAnswerReveal(isCorrect: boolean, selectedIndexes: number[]): boolean {
  return !isCorrect && selectedIndexes.length === 0;
}
