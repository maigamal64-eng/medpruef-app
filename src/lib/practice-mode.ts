/** Practice modes /api/questions accepts. 'exam' is the mock-exam blueprint draw (UX-EXM-23):
 *  like 'all', but it never takes the due-review shortcut, so a Pro learner with due
 *  reviews still gets the full per-topic count. */
export const PRACTICE_MODES = ['all', 'unseen', 'wrong', 'review', 'exam'] as const
export type PracticeMode = (typeof PRACTICE_MODES)[number]

/** Unknown values fall back to 'all' (never an unchecked cast). */
export function parsePracticeMode(raw: string | null | undefined): PracticeMode {
  return (PRACTICE_MODES as readonly string[]).includes(raw ?? '') ? (raw as PracticeMode) : 'all'
}
