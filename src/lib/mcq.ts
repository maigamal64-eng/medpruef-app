export interface MCQOption {
  text: string;
  correct: boolean;
  position?: number;
  image_url?: string | null;
}

export interface StoredChoice {
  text: string;
  correct: boolean;
  position: number;
  image_url?: string | null;
}

/**
 * Build shuffled MCQ options from a structured `choices` JSONB column.
 * Preserves per-choice image_url and keeps the correct count intact.
 */

/**
 * Placeholder options are artefacts of the KoalaMed PDF import: the source
 * itself prints "?" or "-" where an option should be, so there is nothing to
 * recover by re-importing. They leak information (a question with four "?"
 * options hands the answer away) and they look broken to paying users.
 *
 * We hide them at render time rather than deleting them, so the stored row
 * stays a faithful record of the source and a future re-import still dedups.
 *
 * Two invariants, both load-bearing:
 *   1. A choice marked correct is NEVER dropped, whatever its text looks like.
 *   2. If filtering would leave fewer than two options, nothing is filtered.
 *      A one-option question is worse than a question showing a "?".
 */
const PLACEHOLDER_RE = /^[\s?.\-\u2013\u2014_]*$/;

export function isPlaceholderChoice(c: { text?: string | null; correct?: boolean }): boolean {
  if (c.correct) return false;
  const t = (c.text ?? '').trim();
  return t === '' || PLACEHOLDER_RE.test(t);
}

/**
 * Drop placeholder options, preserving both invariants above.
 * Returns the input untouched when filtering would degrade the question.
 */
export function filterDisplayableChoices<T extends { text?: string | null; correct?: boolean }>(
  choices: T[]
): T[] {
  if (!Array.isArray(choices)) return choices;
  const kept = choices.filter(c => !isPlaceholderChoice(c));
  if (kept.length < 2) return choices;
  if (!kept.some(c => c.correct)) return choices;
  return kept;
}

export function buildMCQFromChoices(choices: StoredChoice[]): MCQOption[] {
  return shuffle(filterDisplayableChoices(choices).map(c => ({
    text: c.text,
    correct: !!c.correct,
    position: c.position,
    image_url: c.image_url ?? null,
  })));
}

// Shuffle array in-place using Fisher-Yates
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Check if a question has pre-generated distractors stored in the DB.
 * If so, use them directly instead of generating.
 */
export function buildMCQFromStored(
  answer: string,
  distractors: string[]
): MCQOption[] {
  const options: MCQOption[] = [
    { text: answer, correct: true },
    ...distractors.slice(0, 3).map((text) => ({ text, correct: false })),
  ];
  return shuffle(options);
}

/**
 * For questions WITHOUT pre-generated distractors:
 * Return null to signal that this question should be shown
 * in free-recall / open-answer format instead of MCQ.
 * 
 * This avoids showing nonsensical auto-generated distractors.
 */
export function generateWrongOptions(
  _question: string,
  _answer: string,
  _topic: string
): string[] | null {
  // Return null — question will be shown in open-answer format
  // until AI-generated distractors are available
  return null;
}

/**
 * Build MCQ options. If wrong options are null, returns null
 * to signal open-answer mode.
 */
export function buildMCQOptions(
  answer: string,
  wrongOptions: string[] | null
): MCQOption[] | null {
  if (!wrongOptions || wrongOptions.length < 3) return null;
  const options: MCQOption[] = [
    { text: answer, correct: true },
    ...wrongOptions.slice(0, 3).map((text) => ({ text, correct: false })),
  ];
  return shuffle(options);
}
