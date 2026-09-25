import { beforeEach, describe, expect, it, vi } from 'vitest';
import { studyScope, readStudySession, writeStudySession, resolvePracticeMode } from '@/lib/study-session';
import type { QuizConfig } from '@/components/QuizSetup';
const config: QuizConfig = { examSource: 'kmp_innsbruck', topics: ['Neurologie'], tags: [], targetCount: 40, timeLimitMin: null, examDateFrom: null, examDateTo: null };
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
    for (const other of [studyScope('b',config,'unseen'), studyScope('a',config,'wrong'), studyScope('a',{...config,topics:['Chirurgie']},'unseen'), studyScope('a',{...config,examSource:'kenntnispruefung'},'unseen'), studyScope('a',{...config,tags:['tag']},'unseen')]) expect(readStudySession(other)).toBeNull();
  });
  it('rejects malformed, expired, duplicate and old unscoped trails', () => {
    const key = studyScope('a',config,'unseen');
    const valid = {v:3,savedAt:Date.now(),targetCount:40,answered:[{id:1,correct:true}]};
    for (const bad of [{...valid,v:2},{...valid,savedAt:0},{...valid,targetCount:-1},{...valid,answered:[{id:'a',correct:true}]},{...valid,answered:[{id:1,correct:true},{id:1,correct:false}]}]) { localStorage.setItem(key,JSON.stringify(bad)); expect(readStudySession(key)).toBeNull(); }
  });
});
