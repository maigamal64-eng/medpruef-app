import type { QuizConfig } from '@/components/QuizSetup';
export type PracticeMode = 'unseen' | 'wrong' | 'review' | 'all';
export function resolvePracticeMode(explicit: string | null, stored: string | null): PracticeMode {
  const valid = (value: string | null): value is PracticeMode => ['unseen', 'wrong', 'review', 'all'].includes(value || '');
  return valid(explicit) ? explicit : valid(stored) ? stored : 'unseen';
}
export interface SavedQuizSession {
  v: 3;
  savedAt: number;
  targetCount: number;
  answered: Array<{ id: number; correct: boolean }>;
}
export function studyScope(userId: string, config: QuizConfig, mode: PracticeMode): string {
  return `medpruef-quiz-v3:${JSON.stringify([userId, config.examSource, mode,
    [...config.topics].sort(), [...config.tags].sort(), config.examDateFrom, config.examDateTo,
    config.examYear || '', config.filter || '', [...(config.flaggedIds || [])].sort((a,b) => a-b)])}`;
}
export function readStudySession(scope: string): SavedQuizSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(scope) || 'null') as SavedQuizSession | null;
    if (!s || s.v !== 3 || !Number.isFinite(s.savedAt) || s.savedAt > Date.now() || Date.now()-s.savedAt > 12*60*60*1000 || !Number.isInteger(s.targetCount) || s.targetCount < 1 || s.targetCount > 200 || !Array.isArray(s.answered) || !s.answered.length || s.answered.length > 400 || s.answered.some(a => !Number.isInteger(a.id) || a.id <= 0 || typeof a.correct !== 'boolean') || new Set(s.answered.map(a => a.id)).size !== s.answered.length) return null;
    return s;
  } catch { return null; }
}
export function writeStudySession(scope: string, targetCount: number, answered: SavedQuizSession['answered']): void {
  try { localStorage.setItem(scope, JSON.stringify({ v: 3, savedAt: Date.now(), targetCount, answered: answered.slice(-400) })); } catch {}
}
export function clearStudySession(scope: string): void {
  try { localStorage.removeItem(scope); } catch {}
}
