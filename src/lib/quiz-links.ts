import { safeNext } from './auth-entry';
export interface QuizLink {
  examSource?: string; exam?: string; topic?: string; practiceMode?: string;
  limit?: number; returnTo?: string; questionId?: number | string;
}
/** Account identity is carried by authFetch's signed token, never by a shareable URL. */
export function buildQuizHref({ examSource, exam, topic, practiceMode, limit, returnTo, questionId }: QuizLink = {}): string {
  const params = new URLSearchParams();
  if (examSource || exam) params.set('examSource', examSource || exam || '');
  if (topic) params.set('topic', topic);
  if (practiceMode) params.set('practiceMode', practiceMode);
  if (Number.isFinite(limit) && limit! > 0) params.set('limit', String(Math.min(Math.round(limit!), 200)));
  if (returnTo) params.set('returnTo', safeNext(returnTo));
  // Search needs a specific question rather than a random topic batch.
  if (questionId && /^\d+$/.test(String(questionId))) params.set('questionId', String(questionId));
  return `/quiz${params.size ? `?${params}` : ''}`;
}
export function stripLegacyIdentity(href: string): string {
  const url = new URL(href, 'https://medpruf.com');
  url.searchParams.delete('userId');
  return url.pathname + url.search + url.hash;
}

export type StudyReturnKey = 'plan' | 'progress' | 'curriculum' | 'library' | 'mistakes' | 'history';
const STUDY_RETURNS: ReadonlyArray<[string, StudyReturnKey]> = [
  ['/study-plan', 'plan'], ['/progress', 'progress'], ['/curriculum', 'curriculum'],
  ['/library', 'library'], ['/mistakes', 'mistakes'], ['/history', 'history'],
];
/**
 * UX-STU-20: where the quiz close and result screen return to. Same-origin
 * paths only (safeNext's allowlist), then limited to the study routes; any
 * other value returns null so the quiz falls back to Home.
 */
export function studyReturn(raw: string | null | undefined): { href: string; key: StudyReturnKey } | null {
  const href = safeNext(raw, '');
  if (!href) return null;
  const path = href.split(/[?#]/)[0];
  const hit = STUDY_RETURNS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return hit ? { href, key: hit[1] } : null;
}
