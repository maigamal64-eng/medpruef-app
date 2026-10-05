import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studyScope, readStudySession, writeStudySession, clearStudySession, resolvePracticeMode, getQuizAttemptStats } from '@/lib/study-session';
import type { QuizConfig } from '@/components/QuizSetup';
const config: QuizConfig = { examSource: 'kmp_innsbruck', topics: ['Neurologie'], tags: [], targetCount: 40, timeLimitMin: null, examDateFrom: null, examDateTo: null };
function legacyScopeFromV4(scope: string): string {
  const payload = JSON.parse(scope.slice('medpruef-quiz-v4:'.length)) as unknown[];
  return `medpruef-quiz-v3:${JSON.stringify([...payload.slice(0, 3), ...payload.slice(4)])}`;
}
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k,v), removeItem: (k: string) => data.delete(k) });
});
describe('study intent and safe resume', () => {
  it('defaults to new questions and respects explicit intent over remembered mode', () => {
    expect(resolvePracticeMode(null, null)).toBe('unseen');
    expect(resolvePracticeMode(null, 'wrong')).toBe('wrong');
    expect(resolvePracticeMode('unseen', 'wrong')).toBe('unseen');
    expect(resolvePracticeMode('invalid', 'invalid')).toBe('unseen');
  });
  it('resumes persisted answers but not another account, topic, exam, mode or filter', () => {
    const scope = studyScope('a', config, 'unseen');
    writeStudySession(scope, 40, [{id: 111, correct: true}]);
    expect(readStudySession(scope)?.answered).toEqual([{id:111,correct:true}]);
    for (const other of [studyScope('b',config,'unseen'), studyScope('a',config,'wrong'), studyScope('a',{...config,topics:['Chirurgie']},'unseen'), studyScope('a',{...config,examSource:'kenntnispruefung'},'unseen'), studyScope('a',{...config,tags:['tag']},'unseen'), studyScope('a',{...config,targetCount:1},'unseen')]) expect(readStudySession(other)).toBeNull();
  });
  it('resumes a v3-key session under the matching v4 scope and migrates it without deleting the legacy copy', () => {
    const scope = studyScope('a', config, 'unseen');
    const legacyScope = legacyScopeFromV4(scope);
    const saved = { v: 3, savedAt: Date.now(), targetCount: 40, answered: [{ id: 111, correct: true }] };
    localStorage.setItem(legacyScope, JSON.stringify(saved));

    expect(readStudySession(scope)).toEqual({ ...saved, v: 4 });
    expect(JSON.parse(localStorage.getItem(scope)!)).toEqual({ ...saved, v: 4 });
    expect(JSON.parse(localStorage.getItem(legacyScope)!)).toEqual(saved);
    expect(readStudySession(studyScope('b', config, 'unseen'))).toBeNull();
  });
  it('prefers an existing valid v4 session over a valid v3 legacy session', () => {
    const scope = studyScope('a', config, 'unseen');
    const legacyScope = legacyScopeFromV4(scope);
    const legacy = { v: 3, savedAt: Date.now(), targetCount: 10, answered: [{ id: 111, correct: true }] };
    const current = { v: 4, savedAt: Date.now(), targetCount: 40, answered: [{ id: 222, correct: false }] };
    localStorage.setItem(legacyScope, JSON.stringify(legacy));
    localStorage.setItem(scope, JSON.stringify(current));

    expect(readStudySession(scope)).toEqual(current);
    expect(JSON.parse(localStorage.getItem(scope)!)).toEqual(current);
    expect(JSON.parse(localStorage.getItem(legacyScope)!)).toEqual(legacy);
  });
  it('recovers a legacy session under its saved goal instead of merging it into today\'s scope', () => {
    const scope = studyScope('a', config, 'unseen');
    const legacyScope = legacyScopeFromV4(scope);
    localStorage.setItem(legacyScope, JSON.stringify({ v: 3, savedAt: Date.now(), targetCount: 10, answered: [{ id: 111, correct: true }] }));

    expect(readStudySession(scope)).toEqual({ v: 4, savedAt: expect.any(Number), targetCount: 10, answered: [{ id: 111, correct: true }] });
    expect(localStorage.getItem(scope)).toBeNull();
    expect(JSON.parse(localStorage.getItem(studyScope('a', { ...config, targetCount: 10 }, 'unseen'))!)).toEqual({ v: 4, savedAt: expect.any(Number), targetCount: 10, answered: [{ id: 111, correct: true }] });
    expect(JSON.parse(localStorage.getItem(legacyScope)!)).toMatchObject({ v: 3, targetCount: 10 });
  });
  it('clears only the declined recovery goal and matching legacy record', () => {
    const todayScope = studyScope('a', config, 'unseen');
    const offeredScope = studyScope('a', { ...config, targetCount: 10 }, 'unseen');
    const otherGoalScope = studyScope('a', { ...config, targetCount: 20 }, 'unseen');
    const otherAccountScope = studyScope('b', { ...config, targetCount: 10 }, 'unseen');
    const legacyScope = legacyScopeFromV4(todayScope);
    const save = (targetCount: number, id: number) => JSON.stringify({ v: 4, savedAt: Date.now(), targetCount, answered: [{ id, correct: true }] });
    localStorage.setItem(todayScope, save(40, 140));
    localStorage.setItem(offeredScope, save(10, 110));
    localStorage.setItem(otherGoalScope, save(20, 120));
    localStorage.setItem(otherAccountScope, save(10, 210));
    localStorage.setItem(legacyScope, JSON.stringify({ v: 3, savedAt: Date.now(), targetCount: 10, answered: [{ id: 111, correct: true }] }));

    clearStudySession(todayScope, 10);

    expect(localStorage.getItem(offeredScope)).toBeNull();
    expect(localStorage.getItem(legacyScope)).toBeNull();
    expect(localStorage.getItem(todayScope)).not.toBeNull();
    expect(localStorage.getItem(otherGoalScope)).not.toBeNull();
    expect(localStorage.getItem(otherAccountScope)).not.toBeNull();
  });
  it('persists answer reveals for resume progress without counting them as attempts or wrong answers', () => {
    const key = studyScope('a', config, 'unseen');
    const trail = [{id:111,correct:false},{id:112,correct:false,revealed:true},{id:113,correct:true}];
    writeStudySession(key, 40, trail);
    const resumed = readStudySession(key)!;
    expect(resumed.answered).toEqual(trail);
    expect(getQuizAttemptStats(resumed.answered)).toEqual({processed:3,attempts:2,correct:1,wrong:1});
  });
  it('rejects malformed, expired, duplicate and old unscoped trails', () => {
    const key = studyScope('a',config,'unseen');
    const valid = {v:3,savedAt:Date.now(),targetCount:40,answered:[{id:1,correct:true}]};
    for (const bad of [{...valid,v:2},{...valid,savedAt:0},{...valid,targetCount:-1},{...valid,answered:[{id:'a',correct:true}]},{...valid,answered:[{id:1,correct:true},{id:1,correct:false}]}]) { localStorage.setItem(key,JSON.stringify(bad)); expect(readStudySession(key)).toBeNull(); }
  });
});
