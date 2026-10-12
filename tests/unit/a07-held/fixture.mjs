import { contentHash } from '../../../scripts/content/gate/check.mjs';

export const actor = { id: '00000000-0000-4000-8000-0000000000a7', email: 'fixture@example.invalid' };
const choices = (key) => ['blue square', 'red circle', 'green triangle', 'yellow star'].map((text, i) => ({ text, correct: key.includes(i), position: i, image_url: null }));
export function kpRow(overrides = {}) {
  const c = choices([0]);
  const r = { id: 70001, question: 'Fixture: which shape on the empty board is blue and has four equal sides?', choices: c, answer: 'blue square',
    distractors: ['red circle', 'green triangle', 'yellow star'], explanation: 'Nonmedical fixture: only the blue square matches.',
    source_file: 'SIP_Anki', topic: 'Neurologie', exam_type: 'kenntnispruefung', is_active: true, tags: ['qtype:2'], ...overrides };
  const h = contentHash(r.question);
  return { content_hash: h, content_hash_short: h.slice(0, 12), ...r };
}
export function kmpRow(overrides = {}) {
  const c = ['A true statement', 'A false statement', 'Another true statement'].map((text, i) => ({ text, letter: 'ABC'[i], correct: i !== 1, is_correct: i !== 1 }));
  const r = { id: 112001, question: 'welded tail. Fixture: which statements are true? Bitte ordnen Sie zu.', choices: c, answer: 'A true statement | Another true statement',
    distractors: [], explanation: null, source_file: 'KOALAMED_KMP6a', topic: 'Neurologie', exam_type: 'kmp_innsbruck', is_active: true, tags: ['kmp6a', 'kmp_innsbruck'], ...overrides };
  const h = contentHash(r.question);
  return { content_hash: h, content_hash_short: h.slice(0, 12), ...r };
}
export const rekeyed = (row) => ({ ...row, choices: choices([2]), answer: 'green triangle', distractors: ['blue square', 'red circle', 'yellow star'],
  explanation: 'Nonmedical fixture after the re-key: only the green triangle matches (Fixture guide 2026).' });
