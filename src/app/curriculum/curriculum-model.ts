/**
 * /curriculum pure rules (a25: UX-STU-43, 45, 46). Language-free: every word
 * lives in src/lib/i18n-study-dash.ts.
 *
 * - Coverage is distinct questions seen over the topic total ("gesehen").
 * - The ring colour follows the coverage bucket only; accuracy never recolours it.
 * - The practice link carries no identity (authFetch's signed token does that)
 *   and returns to /curriculum.
 */
import { buildQuizHref } from '@/lib/quiz-links';

export type CoverageBucket = 'well' | 'progress' | 'none';
export type CurriculumMode = 'unseen' | 'review' | 'all';
export type CurriculumSort = 'default' | 'weakest';

/** Vienna is the only bank with the SIP4 / SIP5 split. */
export const VIENNA_EXAM = 'kenntnispruefung';

export const WELL_COVERED_FROM_PCT = 80;

export interface CurriculumTopic {
  topic: string;
  total: number;
  answered: number;
  /** Server Trefferquote or newest-attempt share, null when unknown or nothing answered. */
  accuracyPct: number | null;
}

/**
 * Coverage percentage for display. Never shows 0 once a question was seen and
 * never shows 100 while a question is still unseen, so the bucket and the
 * 100 % action stay truthful at the edges.
 */
export function coveragePct(answered: number, total: number): number {
  if (!(total > 0) || !(answered > 0)) return 0;
  if (answered >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((answered / total) * 100)));
}

export function coverageBucket(pct: number): CoverageBucket {
  if (pct >= WELL_COVERED_FROM_PCT) return 'well';
  if (pct >= 1) return 'progress';
  return 'none';
}

export function isFullyCovered(answered: number, total: number): boolean {
  return total > 0 && answered >= total;
}

/**
 * Practice mode for a subject card. Unseen questions first; once every
 * question was seen, Pro (spaced repetition) gets due reviews and everyone
 * else repeats all questions (review would return 402).
 */
export function curriculumMode(answered: number, total: number, canReview: boolean): CurriculumMode {
  if (!isFullyCovered(answered, total)) return 'unseen';
  return canReview ? 'review' : 'all';
}

export function curriculumTopicHref(input: { topic: string; examSource: string; answered: number; total: number; canReview: boolean }): string {
  return buildQuizHref({
    topic: input.topic,
    examSource: input.examSource || undefined,
    practiceMode: curriculumMode(input.answered, input.total, input.canReview),
    returnTo: '/curriculum',
  });
}

/**
 * "Schwächstes Fach zuerst": lowest coverage first, then lowest accuracy
 * (unknown accuracy after known), then the original order. Stable.
 */
export function sortTopics<T extends CurriculumTopic>(rows: readonly T[], order: CurriculumSort): T[] {
  if (order !== 'weakest') return [...rows];
  return rows
    .map((row, index) => ({ row, index, cov: coveragePct(row.answered, row.total) }))
    .sort((a, b) => {
      if (a.cov !== b.cov) return a.cov - b.cov;
      const aa = a.row.accuracyPct;
      const bb = b.row.accuracyPct;
      if (aa != null && bb != null && aa !== bb) return aa - bb;
      if (aa == null && bb != null) return 1;
      if (aa != null && bb == null) return -1;
      return a.index - b.index;
    })
    .map((x) => x.row);
}

/** Subject names with a slash break after it ("Frauenheilkunde/<wbr>Gynäkologie"). */
export function slashParts(name: string): string[] {
  return name.split(/(?<=\/)/);
}
