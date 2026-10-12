import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerShortcut, createFinaliseGuard, examSelectionState, gradeSelection, updateExamSelection, wallClockRemaining } from '@/lib/practice-exam-state';
import { acknowledgePendingExam, clearExamSession, loadExamSession, loadPendingExams, remainingSeconds, saveExamSession, savePendingExam } from '@/lib/examSession';
import { validActionKey } from '@/lib/puyp-idempotency';
import { shouldIgnoreGlobalKey } from '@/lib/keyboard-guard';
const options = [{ correct: true }, { correct: true }, { correct: false }];
const key = '00000000-0000-4000-8000-000000000041';
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  return values;
}
const session = { startedAt: 1_000, durationS: 600, questions: [{ id: 1, topic: 'Fixture', question: 'Synthetic question', answer: '', explanation: '', difficulty: 1, exam_dates: [] }], answers: { 0: [0] }, flaggedIdxs: [], currentIdx: 0, selectedPart: 'custom', examSource: 'kenntnispruefung', attemptId: key };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('strict practice feedback and selection semantics', () => {
  it('exact set is correct, partial is a strict miss, extra wrong choice is never celebrated', () => {
    expect(gradeSelection(options, [1, 0])).toMatchObject({ state: 'correct', isCorrect: true });
    expect(gradeSelection(options, [0])).toMatchObject({ state: 'partial', isCorrect: false, found: 1, wrong: 0 });
    expect(gradeSelection(options, [0, 2])).toMatchObject({ state: 'partial', isCorrect: false, found: 1, wrong: 1 });
    expect(gradeSelection(options, [2])).toMatchObject({ state: 'wrong', isCorrect: false });
    expect(gradeSelection(options, [])).toMatchObject({ state: 'wrong', isCorrect: false });
  });
  it('unticking final checkbox deletes answer; incomplete sets remain persistent and open', () => {
    const one = updateExamSelection({}, 0, [0]);
    expect(examSelectionState(2, one[0])).toBe('partial');
    const none = updateExamSelection(one, 0, []);
    expect(Object.keys(none)).toHaveLength(0);
    expect(examSelectionState(2, none[0])).toBe('empty');
    expect(examSelectionState(2, [0, 1])).toBe('complete');
  });
  it.each(['ArrowDown', 'Backspace', 'Enter', 'Dead', 'ab', 'F1', ' '])('does not interpret %s as an answer', key => {
    expect(answerShortcut({ key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, 5)).toBeNull();
  });
  it('accepts exactly a letter and rejects every modifier and key repeat', () => {
    const event = { key: 'b', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(answerShortcut(event, 5)).toBe(1);
    for (const flag of ['isComposing', 'repeat', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey']) expect(answerShortcut({ ...event, [flag]: true }, 5)).toBeNull();
    expect(answerShortcut({ ...event, key: 'e' }, 3)).toBeNull();
    expect(answerShortcut({ ...event, key: 'ф', code: 'KeyA' }, 5)).toBe(0);
    expect(answerShortcut({ ...event, key: 'a', code: 'KeyQ' }, 5)).toBe(0);
    expect(answerShortcut({ ...event, key: 'ф', code: '' }, 5)).toBeNull();
    expect(answerShortcut({ ...event, key: '1', code: '' }, 5)).toBe(0);
    expect(answerShortcut({ ...event, key: '٣', code: 'Digit3' }, 5)).toBe(2);
    expect(answerShortcut({ ...event, key: '4', code: 'Numpad4' }, 5)).toBe(3);
    expect(answerShortcut({ ...event, key: 'Enter', code: 'KeyE' }, 5)).toBeNull();
  });
});
describe('wall-clock exam and one finalise operation', () => {
  it('suspended ticks lose the full 30 minutes at resync and a backward clock cannot add time', () => {
    expect(wallClockRemaining(1_000, 14_400, 1_801_000)).toBe(12_600);
    expect(wallClockRemaining(1_000, 14_400, 1_000, 12_600)).toBe(12_600);
    expect(wallClockRemaining(1_000, 14_400, 20_000_000, 12_600)).toBe(0);
  });
  it('manual double tap and expiry run one finalise until a new exam', () => {
    const gate = createFinaliseGuard(); const save = vi.fn();
    expect(gate.run(save)).toBe(true); expect(gate.run(save)).toBe(false); expect(gate.run(save)).toBe(false);
    expect(save).toHaveBeenCalledTimes(1); gate.reset(); gate.run(save); expect(save).toHaveBeenCalledTimes(2);
  });
  it('stored duration owns restored expiry, independently of future defaults', () => {
    storage(); vi.useFakeTimers(); vi.setSystemTime(301_000); saveExamSession('A', session);
    const saved = loadExamSession('A')!;
    expect(remainingSeconds(saved.startedAt, saved.durationS)).toBe(300);
  });
});
describe('pending exam recovery', () => {
  it('failed history save survives reload, new exam and another account, acknowledgement clears only its key', () => {
    storage();
    saveExamSession('A', session);
    expect(savePendingExam('A', { ...session, finishedAt: 500_000 })).toBe(true);
    clearExamSession('A'); saveExamSession('A', { ...session, attemptId: 'new-exam' });
    expect(loadPendingExams('B')).toEqual([]);
    expect(loadPendingExams('A')[0]).toMatchObject({ attemptId: key, answers: { 0: [0] }, finishedAt: 500_000 });
    savePendingExam('A', { ...session, attemptId: 'second-result', finishedAt: 501_000 });
    savePendingExam('A', { ...session, finishedAt: 500_000 });
    expect(loadPendingExams('A')).toHaveLength(2);
    acknowledgePendingExam('A', key);
    expect(loadPendingExams('A').map(row => row.attemptId)).toEqual(['second-result']);
    expect(loadExamSession('A')?.attemptId).toBe('new-exam');
  });
  it('storage refusal is exposed instead of claiming a saved result', () => {
    storage(); vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(saveExamSession('A', session)).toBe(false);
    expect(savePendingExam('A', { ...session, finishedAt: 1_000 })).toBe(false);
  });
  it('validates action UUID before lookup/upload', () => {
    expect(validActionKey(key)).toBe(true);
    expect(validActionKey('../../another-file')).toBe(false);
    expect(validActionKey(null)).toBe(false);
  });
});

describe('global key guard across portal overlays', () => {
  it('blocks an open lightbox, translation menu or dialog even when focus stayed in the page', () => {
    const querySelector = vi.fn(() => ({})); vi.stubGlobal('document', { querySelector });
    expect(shouldIgnoreGlobalKey({ target: null, isComposing: false } as KeyboardEvent)).toBe(true);
    expect(querySelector).toHaveBeenCalledWith(expect.stringContaining('[role="listbox"]'));
    querySelector.mockReturnValue(null as unknown as object);
    expect(shouldIgnoreGlobalKey({ target: null, isComposing: false } as KeyboardEvent)).toBe(false);
    expect(shouldIgnoreGlobalKey({ target: null, isComposing: true } as KeyboardEvent)).toBe(true);
  });
});
