import type { QuizConfig } from '@/components/QuizSetup';
export type PracticeMode = 'unseen' | 'wrong' | 'review' | 'all';
export function resolvePracticeMode(explicit: string | null, stored: string | null): PracticeMode {
  const valid = (value: string | null): value is PracticeMode => ['unseen', 'wrong', 'review', 'all'].includes(value || '');
  return valid(explicit) ? explicit : valid(stored) ? stored : 'unseen';
}
export interface SavedQuizSession {
  v: 3 | 4;
  savedAt: number;
  targetCount: number;
  answered: Array<{ id: number; correct: boolean; revealed?: boolean }>;
}
export function getQuizAttemptStats(answered: SavedQuizSession['answered']) {
  const attempts = answered.filter((item) => !item.revealed);
  const correct = attempts.filter((item) => item.correct).length;
  return { processed: answered.length, attempts: attempts.length, correct, wrong: attempts.length - correct };
}
export function studyScope(userId: string, config: QuizConfig, mode: PracticeMode): string {
  // A changed session goal is a different resumable session. Without this,
  // an old one-question/deep-link session could overwrite a later longer run.
  return `medpruef-quiz-v4:${JSON.stringify([userId, config.examSource, mode, config.targetCount,
    [...config.topics].sort(), [...config.tags].sort(), config.examDateFrom, config.examDateTo,
    config.examYear || '', config.filter || '', [...(config.flaggedIds || [])].sort((a,b) => a-b)])}`;
}
export function readStudySession(scope: string): SavedQuizSession | null {
  const current = readValidSession(scope);
  if (current) return current;

  // v4 added targetCount to the key payload. Rebuild the old payload without
  // that field, keeping the same account and all other quiz dimensions.
  if (!scope.startsWith('medpruef-quiz-v4:')) return null;
  let legacyScope: string;
  try {
    const payload = JSON.parse(scope.slice('medpruef-quiz-v4:'.length)) as unknown;
    if (!Array.isArray(payload) || payload.length !== 11 || typeof payload[0] !== 'string' || !Number.isInteger(payload[3])) return null;
    const legacyPayload = [...payload.slice(0, 3), ...payload.slice(4)];
    legacyScope = `medpruef-quiz-v3:${JSON.stringify(legacyPayload)}`;
  } catch { return null; }
  const legacy = readValidSession(legacyScope);
  if (!legacy) return null;

  // Old keys did not distinguish goals. Re-home the saved trail under its
  // own v4 goal scope, never under today's potentially different goal.
  const recoveryPayload = JSON.parse(scope.slice('medpruef-quiz-v4:'.length)) as unknown[];
  recoveryPayload[3] = legacy.targetCount;
  const recoveryScope = `medpruef-quiz-v4:${JSON.stringify(recoveryPayload)}`;
  const existingRecovery = readValidSession(recoveryScope);
  if (existingRecovery) return existingRecovery;

  const migrated: SavedQuizSession = { ...legacy, v: 4 };
  try {
    // A valid v4 value always wins, including one written by another tab
    // after the initial read. Keep the v3 record as a recovery copy.
    const latest = readValidSession(recoveryScope);
    if (latest) return latest;
    localStorage.setItem(recoveryScope, JSON.stringify(migrated));
  } catch {
    // Reading the valid legacy session still lets the learner resume if
    // storage is temporarily unavailable for the migration write.
  }
  // Even if storage is full, the v3 record remains an actionable resume offer.
  return migrated;
}

function readValidSession(scope: string): SavedQuizSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(scope) || 'null') as SavedQuizSession | null;
    if (!s || (s.v !== 3 && s.v !== 4) || !Number.isFinite(s.savedAt) || s.savedAt > Date.now() || Date.now()-s.savedAt > 12*60*60*1000 || !Number.isInteger(s.targetCount) || s.targetCount < 1 || s.targetCount > 200 || !Array.isArray(s.answered) || !s.answered.length || s.answered.length > 400 || s.answered.some(a => !Number.isInteger(a.id) || a.id <= 0 || typeof a.correct !== 'boolean' || (a.revealed !== undefined && typeof a.revealed !== 'boolean')) || new Set(s.answered.map(a => a.id)).size !== s.answered.length) return null;
    return s;
  } catch { return null; }
}
export function writeStudySession(scope: string, targetCount: number, answered: SavedQuizSession['answered']): void {
  try { localStorage.setItem(scope, JSON.stringify({ v: 4, savedAt: Date.now(), targetCount, answered: answered.slice(-400) })); } catch {}
}
export function clearStudySession(scope: string, targetCount?: number): void {
  try {
    if (targetCount === undefined || !scope.startsWith('medpruef-quiz-v4:')) {
      localStorage.removeItem(scope);
      return;
    }
    const payload = JSON.parse(scope.slice('medpruef-quiz-v4:'.length)) as unknown;
    if (!Array.isArray(payload) || payload.length !== 11 || typeof payload[0] !== 'string') return;
    payload[3] = targetCount;
    const targetScope = `medpruef-quiz-v4:${JSON.stringify(payload)}`;
    localStorage.removeItem(targetScope);

    // Clear the legacy copy only when it is the same offered goal. The v3
    // key did not contain targetCount, so this value check guards the one
    // ambiguous legacy slot shared by all goals for these other dimensions.
    const legacyScope = `medpruef-quiz-v3:${JSON.stringify([...payload.slice(0, 3), ...payload.slice(4)])}`;
    if (readValidSession(legacyScope)?.targetCount === targetCount) localStorage.removeItem(legacyScope);
  } catch {}
}
