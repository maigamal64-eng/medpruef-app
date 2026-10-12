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
