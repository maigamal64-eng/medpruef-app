import { readFileSync } from 'node:fs';
import { contentHash, reviewHash } from '../../../scripts/content/gate/check.mjs';

export const policy = JSON.parse(readFileSync(
  (process.env.TRACK_B_REPORT_ROOT ?? './reports/track-b-2026-10-11') + '/FREEZE.json', 'utf8'));
export const actor = { id: '00000000-0000-4000-8000-0000000000a6', email: 'fixture@example.invalid' };
const base = {
  choices: ['blue square', 'red circle', 'green triangle', 'yellow star', 'grey hexagon'].map((text, i) => ({ text, correct: i === 0, position: i, image_url: null })),
  answer: 'blue square', explanation: 'This nonmedical fixture describes a blue square. Every alternative has a different colour or a different shape, so exactly one option matches.',
  exam_type: 'kenntnispruefung', is_active: false, image_url: null, image_urls: [],
};
export function archiveRow(overrides = {}) {
  const r = { id: 114300, question: 'Fixture archive item: which shape is the blue square on an otherwise empty drawing board', topic: 'Psychiatrie',
    source_file: 'ARCHIVE_ORIGINAL_W1', tags: ['archive-original', 'archive-w1', 'needs-second-read'], ...base, ...overrides };
  return { ...r, content_hash: contentHash(r.question) };
}
export function authoredRow(overrides = {}) {
  const r = { id: 120001, question: 'Fixture authored item: pick the option naming a blue four sided figure with equal edges', topic: 'Neurologie',
    source_file: 'TRACK_B_FIXTURE', tags: ['authored-track-b'], ...base, ...overrides };
  return { ...r, content_hash: contentHash(r.question) };
}
export function entry(row, readers = ['fixture-reader-a', 'fixture-reader-b']) {
  return { id: row.id, reviews: readers.map((reviewer) => ({ reviewer, verdict: 'APPROVE', explanation_consistent_with_key: 'yes',
    reviewed_content_sha256: reviewHash(row), source_url: 'https://example.invalid/fixture', source_sha256: 'a'.repeat(64),
    read_on: '2026-10-11', guideline_edition: 'Nonmedical fixture v1', verdict_ref: 'fixture-only' })),
  rights_basis: { status: 'cleared', basis: 'original-authorship', evidence_ref: 'fixture-ngram', recorded_by: 'test' } };
}
export const manifest = (kind, rows) => ({ batch_id: `a06-fixture-${kind}`, kind, actor, reason: 'Fixture activation for the a06 proof', entries: rows.map((r) => entry(r)) });
