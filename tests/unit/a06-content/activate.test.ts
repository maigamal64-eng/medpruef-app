import { describe, it, expect } from 'vitest';
import { checkTrackA, emitActivation, afterTags, REVIEW_TAG, VIENNA_TOPICS, STP_FIELD_LABELS } from '../../../scripts/content/a06/activate.mjs';
import { STP_FIELDS } from '../../../src/lib/stp-fields';
import { VIENNA_EXAM_PARTS } from '../../../src/lib/topics';
import { jsonbOrder, insertedReviewHash } from '../../../scripts/content/a06/jsonb.mjs';
import { reviewHash } from '../../../scripts/content/gate/check.mjs';
// @ts-expect-error untyped fixture module
import { policy, archiveRow, authoredRow, entry, manifest } from './fixture.mjs';

type Row = Record<string, unknown>;
const check = (rows: Row[], kind: string, corpus = rows) => checkTrackA(rows, rows.map((r) => entry(r)), corpus, policy, kind);

describe('a06 activation gate', () => {
  it('admits a reviewed archive original that the b20 gate refuses', () => {
    const [result] = check([archiveRow()], 'archive');
    expect(result.errors).toEqual([]);
    expect(result.pass).toBe(true);
    const [asAuthored] = check([archiveRow()], 'authored');
    expect(asAuthored.errors).toEqual(expect.arrayContaining(['ID_NOT_NEW', 'ARCHIVE', 'NOT_AUTHORED']));
  });
  it('still requires two distinct hash-bound approvals and cleared rights', () => {
    const row = archiveRow();
    const one = { ...entry(row), reviews: entry(row).reviews.slice(0, 1) };
    expect(checkTrackA([row], [one], [row], policy, 'archive')[0].errors).toContain('TWO_MEDICAL_APPROVALS');
    const same = entry(row, ['reader-x', 'Reader-X ']);
    expect(checkTrackA([row], [same], [row], policy, 'archive')[0].errors).toContain('TWO_MEDICAL_APPROVALS');
    const stale = entry(archiveRow({ explanation: 'An older explanation text that the readers saw before it was edited by someone.' }));
    expect(checkTrackA([row], [stale], [row], policy, 'archive')[0].errors).toContain('TWO_MEDICAL_APPROVALS');
    const noRights = { ...entry(row), rights_basis: null };
    expect(checkTrackA([row], [noRights], [row], policy, 'archive')[0].errors).toContain('RIGHTS_NOT_CLEARED');
  });
  it('keeps uncovered areas, unknown topics, six options, missing images and unstated multi answers out', () => {
    expect(check([archiveRow({ topic: 'Public Health' })], 'archive')[0].errors).toEqual(expect.arrayContaining(['UNCOVERED_TOPIC', 'TOPIC_NOT_CANONICAL']));
    expect(check([archiveRow({ topic: 'Anästhesie' })], 'archive')[0].errors).toContain('TOPIC_NOT_CANONICAL');
    const six = archiveRow({ choices: [...archiveRow().choices, { text: 'white oval', correct: false, position: 5, image_url: null }] });
    expect(check([six], 'archive')[0].errors).toContain('OPTIONS');
    expect(check([archiveRow({ question: 'Fixture item: was zeigt die Abbildung auf dem leeren Zeichenbrett heute' })], 'archive')[0].errors).toContain('IMAGE_MISSING');
    expect(check([authoredRow({ tags: ['authored-track-b', 'image-needed'] })], 'authored')[0].errors).toContain('IMAGE_MISSING');
    expect(check([authoredRow({ tags: ['authored-track-b', 'image-needed'], image_urls: ['https://example.invalid/a.webp'] })], 'authored')[0].errors).not.toContain('IMAGE_MISSING');
    const multi = archiveRow({ choices: archiveRow().choices.map((c: Row, i: number) => ({ ...c, correct: i < 2 })) });
    expect(check([multi], 'archive')[0].errors).toContain('MULTI_WITHOUT_N');
  });
  it('refuses archive rows outside the range, a frozen policy id and an active row', () => {
    expect(check([archiveRow({ id: 114700 })], 'archive')[0].errors).toContain('NOT_ARCHIVE_RANGE');
    const frozen = [...(policy.protected?.ids ?? [])][0];
    if (frozen) expect(check([archiveRow({ id: frozen })], 'archive')[0].errors).toContain('FROZEN_ID');
    expect(check([archiveRow({ is_active: true })], 'archive')[0].errors).toContain('NOT_INACTIVE');
  });
  it('only uses the ten Vienna topics for kenntnispruefung and the official STP fields for Innsbruck', () => {
    expect([...VIENNA_TOPICS].sort()).toEqual([...VIENNA_EXAM_PARTS.sip4, ...VIENNA_EXAM_PARTS.sip5].sort());
    expect([...STP_FIELD_LABELS]).toEqual(STP_FIELDS.map((f) => f.label.de));
    const innsbruck = authoredRow({ exam_type: 'kmp_innsbruck', topic: 'Notfallmedizin' });
    expect(check([innsbruck], 'authored', [innsbruck])[0].errors).not.toContain('TOPIC_NOT_CANONICAL');
    expect(check([authoredRow({ exam_type: 'kmp_innsbruck', topic: 'Erfundenes Fach' })], 'authored')[0].errors).toContain('TOPIC_NOT_CANONICAL');
    expect(check([authoredRow()], 'authored')[0].pass).toBe(true);
  });
  it('emits activation with reviewer and rights tags, activation log and audit rows, and refuses a failed gate', () => {
    const rows = [archiveRow(), archiveRow({ id: 114301, question: 'Fixture archive item two: name the red circle drawn alone on white paper today' })];
    const results = check(rows, 'archive');
    const files = emitActivation(manifest('archive', rows), rows, results);
    expect(afterTags(rows[0], 'original-authorship')).toEqual(['archive-original', 'archive-w1', REVIEW_TAG, 'rights:original-authorship']);
    expect(afterTags({ tags: ['authored-track-b', 'medical-review-pending'] }, 'original-authorship')).toEqual(['authored-track-b', REVIEW_TAG, 'rights:original-authorship']);
    expect(files.apply).toContain('INSERT INTO question_activation_log');
    expect(files.apply).toContain("'a06_content_activation'");
    expect(files.rollback).toContain("'a06_content_activation_rollback'");
    expect(files.apply).not.toMatch(/^\s*(DELETE|TRUNCATE|DROP|ALTER)\b/im);
    expect(files.apply).toContain('CREATE TEMP TABLE a06_corpus ON COMMIT DROP');
    expect(files.beforeImages[0].tags).toContain('needs-second-read');
    expect(() => emitActivation({ ...manifest('archive', rows), reason: 'short' }, rows, results)).toThrow(/reason/);
    const bad = check([archiveRow({ topic: 'Public Health' })], 'archive');
    expect(() => emitActivation(manifest('archive', [archiveRow()]), [archiveRow()], bad)).toThrow(/failed/);
  });
  it('orders jsonb keys by length then bytes so pre-insert review hashes match fetched rows', () => {
    expect(Object.keys(jsonbOrder({ letter: 'A', text: 'x', correct: true, is_correct: true }))).toEqual(['text', 'letter', 'correct', 'is_correct']);
    const row = authoredRow({ choices: [{ letter: 'A', text: 'x', correct: true, is_correct: true }] });
    expect(insertedReviewHash(row)).toBe(reviewHash({ ...row, choices: [{ text: 'x', letter: 'A', correct: true, is_correct: true }] }));
  });
});

describe('a06 guarded content edit', () => {
  it('allows only stem, explanation and hash edits, with a matching stem hash', async () => {
    const { emitEdit, validateEdit } = await import('../../../scripts/content/a06/edit.mjs');
    const { contentHash } = await import('../../../scripts/content/gate/check.mjs');
    const before = { ...archiveRow(), content_hash_short: archiveRow().content_hash.slice(0, 12) };
    const q = before.question + ' now';
    const after = { ...before, question: q, explanation: before.explanation + ' Ergänzt.', content_hash: contentHash(q), content_hash_short: contentHash(q).slice(0, 12) };
    expect(validateEdit({ before, after })).toEqual(['question', 'explanation', 'content_hash', 'content_hash_short']);
    expect(() => validateEdit({ before, after: { ...after, answer: 'red circle' } })).toThrow(/non-editable/);
    expect(() => validateEdit({ before, after: { ...after, content_hash: before.content_hash } })).toThrow(/content_hash/);
    const sql = emitEdit({ batch_id: 'a06-edit-fixture', actor: { id: '00000000-0000-4000-8000-0000000000a6', email: 'f@example.invalid' }, reason: 'Fixture edit for the a06 proof', edits: [{ before, after }] });
    expect(sql.apply).toContain("'a06_content_edit'");
    expect(sql.rollback).toContain("'a06_content_edit_rollback'");
  });
});
