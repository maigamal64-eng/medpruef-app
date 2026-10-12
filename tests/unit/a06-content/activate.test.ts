import { describe, it, expect } from 'vitest';
import { checkTrackA, emitActivation, afterTags, REVIEW_TAG, VIENNA_TOPICS } from '../../../scripts/content/a06/activate.mjs';
import { jsonbOrder, insertedReviewHash } from '../../../scripts/content/a06/jsonb.mjs';
import { reviewHash } from '../../../scripts/content/gate/check.mjs';
// @ts-expect-error untyped fixture module
import { policy, archiveRow, authoredRow, entry, manifest } from './fixture.mjs';

const check = (rows: any[], kind: string, corpus = rows) => checkTrackA(rows, rows.map((r) => entry(r)), corpus, policy, kind);

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
    const multi = archiveRow({ choices: archiveRow().choices.map((c: any, i: number) => ({ ...c, correct: i < 2 })) });
    expect(check([multi], 'archive')[0].errors).toContain('MULTI_WITHOUT_N');
  });
  it('refuses archive rows outside the range, a frozen policy id and an active row', () => {
    expect(check([archiveRow({ id: 114700 })], 'archive')[0].errors).toContain('NOT_ARCHIVE_RANGE');
    const frozen = [...(policy.protected?.ids ?? [])][0];
    if (frozen) expect(check([archiveRow({ id: frozen })], 'archive')[0].errors).toContain('FROZEN_ID');
    expect(check([archiveRow({ is_active: true })], 'archive')[0].errors).toContain('NOT_INACTIVE');
  });
  it('only uses the ten Vienna topics for kenntnispruefung', () => {
    expect(VIENNA_TOPICS).toHaveLength(10);
    expect(check([authoredRow()], 'authored')[0].pass).toBe(true);
  });
  it('emits activation with reviewer and rights tags, activation log and audit rows, and refuses a failed gate', () => {
    const rows = [archiveRow(), archiveRow({ id: 114301, question: 'Fixture archive item two: name the red circle drawn alone on white paper today' })];
    const results = check(rows, 'archive');
    const files = emitActivation(manifest('archive', rows), rows, results);
    expect(afterTags(rows[0], 'original-authorship')).toEqual(['archive-original', 'archive-w1', REVIEW_TAG, 'rights:original-authorship']);
    expect(files.apply).toContain('INSERT INTO question_activation_log');
    expect(files.apply).toContain("'a06_content_activation'");
    expect(files.rollback).toContain("'a06_content_activation_rollback'");
    expect(files.apply).not.toMatch(/DELETE|TRUNCATE|DROP/i);
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
