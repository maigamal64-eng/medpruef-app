export interface MCQOption {
  text: string;
  correct: boolean;
}

// Shuffle array in-place using Fisher-Yates
function shuffle<T>(arr: T[]): T[] {
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
