/**
 * Which questions work as a flashcard (UX-PRA-64). Pure, server-safe.
 *
 * A flashcard shows the stem, the learner recalls, then flips. Two kinds of
 * question cannot be recalled without their options and stay in the quiz:
 *
 *  - multi: more than one correct option (n_correct, reliable).
 *  - option_dependent: a single-answer stem that only makes sense next to its
 *    options ("Welche Aussage trifft zu?"). This is a conservative heuristic:
 *    it only matches phrasings that point at the option list, so a recall
 *    question such as "Welche Diagnose ist am wahrscheinlichsten?" stays a card.
 *
 * /api/questions?flashcard=1 applies it server-side and reports the skipped
 * counts per rule, so the flashcard header can say why the queue is smaller.
 */
export type FlashcardSkipReason = "multi" | "option_dependent";

const OPTION_DEPENDENT: RegExp[] = [
  /\bwelche[rsn]?\s+(?:der|dieser|von\s+den)\s+(?:folgenden|genannten|oben\s+genannten|aufgeführten|angegebenen|aufgezählten)\b/i,
  /\bwelche[rsn]?\s+(?:aussage|aussagen|antwort|antworten|kombination|behauptung|behauptungen|feststellung|feststellungen)\b/i,
  /\b(?:trifft|treffen)\s+(?:am\s+ehesten\s+|nicht\s+|am\s+wenigsten\s+)?zu\b/i,
  /\b(?:ist|sind)\s+(?:nicht\s+)?(?:richtig|falsch|korrekt|zutreffend|unzutreffend)\s*\??\s*$/i,
  /\bwas\s+gilt\b/i,
  /\b(?:au(?:ss|ß)er|ausnahme)\b[^.?!]*\?\s*$/i,
  /\bwhich\s+(?:of\s+the\s+following|statement|statements|answer|option)\b/i,
];

interface CardCandidate {
  question?: unknown;
  n_correct?: unknown;
}

export function flashcardSkipReason(q: CardCandidate): FlashcardSkipReason | null {
  const nCorrect = Number(q.n_correct ?? 1);
  if (Number.isFinite(nCorrect) && nCorrect > 1) return "multi";
  const stem = typeof q.question === "string" ? q.question : "";
  if (OPTION_DEPENDENT.some((rule) => rule.test(stem))) return "option_dependent";
  return null;
}

export interface FlashcardSplit<T> {
  cards: T[];
  skippedIds: number[];
  skipped: Record<FlashcardSkipReason, number>;
}

export function splitFlashcards<T extends CardCandidate & { id?: unknown }>(rows: readonly T[]): FlashcardSplit<T> {
  const out: FlashcardSplit<T> = { cards: [], skippedIds: [], skipped: { multi: 0, option_dependent: 0 } };
  for (const row of rows) {
    const reason = flashcardSkipReason(row);
    if (!reason) { out.cards.push(row); continue; }
    out.skipped[reason] += 1;
    const id = Number(row.id);
    if (Number.isInteger(id) && id > 0) out.skippedIds.push(id);
  }
  return out;
}

/** Header names the flashcard page reads (kept here so route and page agree). */
export const FLASHCARD_HEADERS = {
  skippedIds: "x-flashcard-skipped-ids",
  multi: "x-flashcard-skipped-multi",
  optionDependent: "x-flashcard-skipped-options",
} as const;
