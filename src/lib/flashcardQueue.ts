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

/**
 * In-session re-queue (UX-GLOBAL-34, PRA-60): "Nochmal" brings the card back
 * 4 cards later (inside the 3 to 5 window), "Schwer" once more later in the
 * session (8 cards on). A card is re-queued for "Schwer" only once.
 */
export const AGAIN_GAP = 4;
export const HARD_GAP = 8;

export interface RequeueItem<T extends { id: number }> {
  card: T;
  /** Number of cards shown after which this card is due again. */
  at: number;
  reason: "again" | "hard";
}

export function requeueAfterRating<T extends { id: number }>(
  queue: readonly RequeueItem<T>[],
  card: T,
  rating: "again" | "hard" | "good" | "easy",
  shown: number,
  hardOnce: Set<number>,
): RequeueItem<T>[] {
  const rest = queue.filter((item) => item.card.id !== card.id);
  if (rating === "again") return [...rest, { card, at: shown + AGAIN_GAP, reason: "again" }];
  if (rating === "hard" && !hardOnce.has(card.id)) {
    hardOnce.add(card.id);
    return [...rest, { card, at: shown + HARD_GAP, reason: "hard" }];
  }
  return rest;
}

/** The earliest re-queued card that is due at `shown`, if any. */
export function takeDueRequeue<T extends { id: number }>(
  queue: readonly RequeueItem<T>[],
  shown: number,
): { card: T | null; rest: RequeueItem<T>[] } {
  const due = [...queue].filter((item) => item.at <= shown).sort((a, b) => a.at - b.at)[0];
  if (!due) return { card: null, rest: [...queue] };
  return { card: due.card, rest: queue.filter((item) => item !== due) };
}
