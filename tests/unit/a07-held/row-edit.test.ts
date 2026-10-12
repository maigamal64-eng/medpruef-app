import { describe, it, expect } from 'vitest';
import { emitRowEdits, validateRowEdit, withStem, withTags } from '../../../scripts/content/a07/row-edit.mjs';
// @ts-expect-error untyped fixture module
import { actor, kpRow, kmpRow, rekeyed } from './fixture.mjs';

const batch = (edits: unknown[], extra: Record<string, unknown> = {}) =>
  emitRowEdits({ batch_id: 'a07-fixture', actor, reason: 'Fixture re-key for the a07 proof', edits, ...extra });

describe('a07 row edit rules', () => {
  it('accepts a re-key and reports the changed columns', () => {
    const before = kpRow();
    expect(validateRowEdit({ before, after: rekeyed(before) })).toEqual(['choices', 'answer', 'distractors', 'explanation']);
  });
  it('refuses columns outside the editable set and key_revision', () => {
    const before = kpRow();
    expect(() => validateRowEdit({ before, after: { ...before, topic: 'Psychiatrie' } })).toThrow(/non-editable columns: topic/);
    expect(() => validateRowEdit({ before, after: { ...before, source_file: 'X' } })).toThrow(/non-editable/);
  });
  it('requires the answer and distractors to follow the marked choices', () => {
    const before = kpRow();
    expect(() => validateRowEdit({ before, after: { ...rekeyed(before), answer: 'blue square' } })).toThrow(/answer does not list/);
    expect(() => validateRowEdit({ before, after: { ...rekeyed(before), distractors: ['red circle'] } })).toThrow(/distractors/);
  });
  it('keeps the Innsbruck empty distractors convention and is_correct in step', () => {
    const before = kmpRow();
    const c = before.choices.map((x: { correct: boolean }, i: number) => ({ ...x, correct: i === 0, is_correct: i === 0 }));
    expect(validateRowEdit({ before, after: { ...before, choices: c, answer: 'A true statement' } })).toEqual(['choices', 'answer']);
    expect(() => validateRowEdit({ before, after: { ...before, choices: c.map((x: object) => ({ ...x, is_correct: true })), answer: 'A true statement' } })).toThrow(/is_correct differs/);
    expect(() => validateRowEdit({ before, after: { ...before, choices: c, answer: 'A true statement', distractors: ['A false statement'] } })).toThrow(/convention/);
  });
  it('checks the stated N against the marked answers and requires N on Vienna multi-answer rows', () => {
    const before = kpRow();
    const two = before.choices.map((x: { correct: boolean }, i: number) => ({ ...x, correct: i < 2 }));
    const after = { ...before, choices: two, answer: 'blue square | red circle', distractors: ['green triangle', 'yellow star'] };
    expect(() => validateRowEdit({ before, after })).toThrow(/without N/);
    expect(() => validateRowEdit({ before, after: withStem(after, before.question + ' (3 richtige Antworten)') })).toThrow(/stated N differs/);
    expect(validateRowEdit({ before, after: withStem(after, before.question + ' (2 richtige Antworten)') })).toContain('question');
  });
  it('requires a recomputed content hash on a stem edit and refuses dash characters', () => {
    const before = kmpRow();
    expect(() => validateRowEdit({ before, after: { ...before, question: 'Fixture: which statements are true? Bitte ordnen Sie zu.' } })).toThrow(/content_hash/);
    const fixed = withStem(before, 'Fixture: which statements are true? Bitte ordnen Sie zu.');
    expect(validateRowEdit({ before, after: fixed })).toEqual(['question', 'content_hash', 'content_hash_short']);
    expect(() => validateRowEdit({ before, after: withStem(before, 'Fixture — which statements are true?') })).toThrow(/dash/);
  });
  it('refuses frozen ids and deactivating a protected survivor', () => {
    const before = kpRow();
    expect(() => validateRowEdit({ before, after: rekeyed(before) }, { frozen: [70001] })).toThrow(/frozen/);
    expect(() => validateRowEdit({ before, after: { ...before, is_active: false } }, { protected: [70001] })).toThrow(/protected/);
    expect(validateRowEdit({ before, after: { ...before, is_active: false } })).toEqual(['is_active']);
  });
  it('refuses an active row left with fewer than two choices', () => {
    const before = kpRow();
    const one = [{ ...before.choices[0] }];
    expect(() => validateRowEdit({ before, after: { ...before, choices: one, distractors: [] } })).toThrow(/at least two/);
  });
  it('merges tags without duplicates', () => {
    expect(withTags({ tags: ['a', 'b'] }, { add: ['b', 'c'], remove: ['a'] }).tags).toEqual(['b', 'c']);
  });
});

describe('a07 SQL shape', () => {
  it('locks, guards the triggers and the before image, audits, verifies and commits', () => {
    const before = kpRow();
    const f = batch([{ before, after: rekeyed(before) }], { refs: { 70001: { pick: 'pick-fixture' } } });
    expect(f.apply).toMatch(/^-- A07-ROWS: a07-fixture\n-- A07-MODE: apply/);
    expect(f.apply).toContain('FOR UPDATE');
    expect(f.apply).toContain('questions_clear_ai_explanation_on_key_change');
    expect(f.apply).toContain('questions_aa_guard_key_revision');
    expect(f.apply).toContain("'Before image changed for 70001'");
    expect(f.apply).toContain('a07_content_edit');
    expect(f.apply).toContain('pick-fixture');
    expect(f.apply).not.toMatch(/key_revision\s*=/);
    expect(f.apply).not.toMatch(/ai_explanation\s*=/);
    expect(f.apply.trim().endsWith('COMMIT;')).toBe(true);
    expect(f.rollback).toContain('a07_content_edit_rollback');
    expect(f.verify).toMatch(/A07-MODE: verify \(read-only\)/);
  });
  it('names a deactivation-only file and skips the key trigger guard', () => {
    const before = kpRow();
    const f = batch([{ before, after: { ...before, is_active: false } }]);
    expect(f.apply).toContain("'a07_content_deactivate'");
    expect(f.apply).not.toContain('questions_clear_ai_explanation_on_key_change');
  });
  it('refuses more than 50 rows, repeated ids, a bad actor and a short reason', () => {
    const rows = Array.from({ length: 51 }, (_, i) => { const b = kpRow({ id: 1000 + i }); return { before: b, after: { ...b, is_active: false } }; });
    expect(() => batch(rows)).toThrow(/1 to 50/);
    const b = kpRow();
    expect(() => batch([{ before: b, after: { ...b, is_active: false } }, { before: b, after: { ...b, is_active: false } }])).toThrow(/Repeated/);
    expect(() => emitRowEdits({ batch_id: 'a07-x', actor: { id: 'x', email: 'y' }, reason: 'long enough reason', edits: [{ before: b, after: { ...b, is_active: false } }] })).toThrow(/Actor/);
    expect(() => emitRowEdits({ batch_id: 'a07-x', actor, reason: 'short', edits: [{ before: b, after: { ...b, is_active: false } }] })).toThrow(/reason/);
  });
});
