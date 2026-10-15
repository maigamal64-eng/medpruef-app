import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error untyped fixture module
import { actor, kpRow, kmpRow } from '../a07-held/fixture.mjs';
// @ts-expect-error untyped
import { plan as fmtPlan, stage as fmtStage, customId, classify, pilotReport } from '../../../scripts/content/batch-port/format.mjs';
// @ts-expect-error untyped
import { plan as notesPlan, stage as notesStage, buildRow, noteId, qnoteKey, NOTES_RUN_TAG } from '../../../scripts/content/batch-port/notes.mjs';
// @ts-expect-error untyped
import { emitDirs } from '../../../scripts/content/batch-port/emit-edits.mjs';
// @ts-expect-error untyped
import { emitNoteFiles } from '../../../scripts/content/batch-port/emit-notes.mjs';
import { emitRowEdits } from '../../../scripts/content/a07/row-edit.mjs';

const ROOT = path.resolve(__dirname, '..', '..', '..');
let out: string;
beforeEach(() => { out = mkdtempSync(path.join(tmpdir(), 'batch-port-')); });
const result = (custom_id: string, value: unknown, extra = {}) => ({ custom_id, type: 'succeeded', text: JSON.stringify(value), stop_reason: 'end_turn', model: 'claude-sonnet-5-5', micro: 1000, ...extra });
const writeResults = (rows: unknown[]) => writeFileSync(path.join(out, 'results.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const fake = (rows: unknown[]) => ({ restAll: async () => rows, restGet: async () => rows });
const fix = (over = {}) => ({ stem_cleaned: '', choices_cleaned: null, explanation_de: null, needs_medical_review: false, review_reason: null, confidence: 0.9, ...over });

describe('format-questions on batches', () => {
  it('plans items with explicit model, effort, schema and no pending rows', async () => {
    const needs = kpRow({ id: 1, explanation: null });
    const done = kpRow({ id: 2 });
    const r = await fmtPlan({ client: fake([needs, done]), out });
    expect(r.items).toBe(1);
    const item = JSON.parse(readFileSync(path.join(out, 'items.jsonl'), 'utf8').trim());
    expect(item.custom_id).toBe(customId(needs));
    expect(item.params).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' });
    expect(item.params.output_format.type).toBe('json_schema');
    expect(classify(needs).needsExplanation).toBe(true);
  });

  it('stages explanations as a07 edits that emit apply, rollback and verify unchanged; dashes are cleaned', async () => {
    const q = kpRow({ id: 10, explanation: null });
    await fmtPlan({ client: fake([q]), out });
    const exp = 'Die blaue Form ist das Quadrat — nur dieses hat vier gleiche Seiten. Die anderen Formen passen nicht, weil sie keine vier gleichen Seiten besitzen.';
    writeResults([result(customId(q), fix({ stem_cleaned: q.question, explanation_de: exp }))]);
    const s = fmtStage({ out });
    expect(s.edits).toBe(1);
    const dirs = emitDirs(path.join(out, 'edits'), actor);
    expect(dirs).toHaveLength(1);
    const sql = readFileSync(path.join(dirs[0].dir, 'apply.sql'), 'utf8');
    expect(sql).toContain('BEGIN;');
    expect(existsSync(path.join(dirs[0].dir, 'rollback.sql'))).toBe(true);
    const e = JSON.parse(readFileSync(path.join(dirs[0].dir, 'edits.json'), 'utf8'));
    expect(e.edits[0].after.explanation).not.toMatch(/[–—]/);
    expect(e.edits[0].after.choices).toEqual(q.choices);
    expect(e.refs['10'].needs_reads).toBe(2);
  });

  it('holds flagged rows and routes option clean-ups to held-choice-proposals, never to edits', async () => {
    const flagged = kpRow({ id: 20, explanation: null });
    const choiceFix = kpRow({ id: 21, explanation: 'Schon vorhanden und lang genug, damit nichts zu erklären ist.' });
    choiceFix.question = 'Fixture  mit  doppelten Leerzeichen ?';
    await fmtPlan({ client: fake([flagged, choiceFix]), out });
    const cleaned = choiceFix.choices.map((c: { text: string }, i: number) => ({ text: i === 0 ? `${c.text} ` : c.text }));
    writeResults([
      result(customId(flagged), fix({ needs_medical_review: true, review_reason: 'key looks wrong', explanation_de: 'x'.repeat(80) })),
      result(customId(choiceFix), fix({ stem_cleaned: 'Fixture mit doppelten Leerzeichen?', choices_cleaned: cleaned })),
    ]);
    const s = fmtStage({ out });
    expect(s.held).toBe(1);
    expect(s.choiceProposals).toBe(1);
    const held = JSON.parse(readFileSync(path.join(out, 'held.json'), 'utf8'));
    expect(held[0]).toMatchObject({ id: 20, reason: 'needs_medical_review' });
    const proposals = JSON.parse(readFileSync(path.join(out, 'held-choice-proposals.json'), 'utf8'));
    expect(proposals[0].id).toBe(21);
    for (const d of readdirSync(path.join(out, 'edits'))) {
      const e = JSON.parse(readFileSync(path.join(out, 'edits', d, 'edits.json'), 'utf8'));
      for (const ed of e.edits) expect(ed.after.choices).toEqual(ed.before.choices);
    }
  });

  it('never applies a content-changing stem edit and ignores a failing parse', async () => {
    const q = kpRow({ id: 30, explanation: null });
    const q2 = kpRow({ id: 31, explanation: null });
    await fmtPlan({ client: fake([q, q2]), out });
    writeResults([
      result(customId(q), fix({ stem_cleaned: 'Ganz anderer Text mit neuem Inhalt', explanation_de: 'Kurz.' })),
      { custom_id: customId(q2), type: 'succeeded', text: 'not json', stop_reason: 'end_turn' },
    ]);
    const s = fmtStage({ out });
    expect(s.edits).toBe(0);
    expect(s.rejected).toBe(1);
  });

  it('a stem change beyond whitespace is not formatting (Hb 1,5 vs Hb 15, < vs >) and a stem edit needs reads', async () => {
    const q = kpRow({ id: 60, question: 'Hb 1,5 g/dl bei  Aufnahme ?', explanation: null });
    await fmtPlan({ client: fake([q]), out });
    writeResults([result(customId(q), fix({ stem_cleaned: 'Hb 15 g/dl bei Aufnahme?' }))]);
    expect(fmtStage({ out }).edits).toBe(0);
    writeResults([result(customId(q), fix({ stem_cleaned: 'Hb 1,5 g/dl bei Aufnahme?' }))]);
    expect(fmtStage({ out }).edits).toBe(1);
    const e = JSON.parse(readFileSync(path.join(out, 'edits', 'fmt-batch-0001', 'edits.json'), 'utf8'));
    expect(e.refs['60'].needs_reads).toBe(2);
  });

  it('pilot staging produces a report and no applicable edits', async () => {
    const old = [{ question_id: 40, before: { question: kpRow().question, choices: kpRow().choices, explanation: null }, after: { patch: { explanation: 'alt '.repeat(20) } }, applied_fields: ['explanation'], needs_medical_review: false, model: 'gpt-5-mini' }];
    await fmtPlan({ client: { restGet: async (qy: string) => (qy.startsWith('question_format_fixes') ? old : [kpRow({ id: 40 })]), restAll: async () => [] }, out, pilot: 20 });
    const snap = JSON.parse(readFileSync(path.join(out, 'snapshot.json'), 'utf8'));
    expect(snap.pilot).toBe(true);
    writeResults([result(customId(snap.rows[0]), fix({ explanation_de: 'Neue Erklärung mit ausreichend Länge, damit sie angenommen wird und verglichen werden kann.' }))]);
    const s = fmtStage({ out });
    expect(s.pilot).toBe(true);
    expect(existsSync(path.join(out, 'edits'))).toBe(false);
    const rep = await pilotReport({ out, oldRows: old });
    expect(rep.items).toBe(1);
    expect(rep.rows[0].old_model).toBe('gpt-5-mini');
  });
});

describe('generate-notes on batches', () => {
  const good = { title: 'Kompakt: Fixture', blocks: [{ type: 'concept', front: 'Frage?', back: 'Antwort.' }, { type: 'keyfact', text: 'Fakt — mit Strich.' }], tags: ['Fixture'] };
  const qrow = { id: 5, question: 'Q', choices: [{ text: 'a', correct: true }], answer: 'a', explanation: 'E', exam_type: 'kenntnispruefung', topic: 'Neurologie' };

  it('stages a q-note with owner, kuratiert tag, stable id and no dashes; refuses PII and exam claims', async () => {
    const client = { restGet: async (qy: string) => (qy.startsWith('question_popularity') ? [{ question_id: 5, n: 9 }] : [qrow]), restAll: async () => [] };
    await notesPlan({ client, out, phase: 'qnotes', top: 1 });
    const id = JSON.parse(readFileSync(path.join(out, 'items.jsonl'), 'utf8').trim()).custom_id as string;
    writeResults([result(id, good)]);
    const s = notesStage({ out });
    expect(s.staged).toBe(1);
    const row = JSON.parse(readFileSync(path.join(out, 'notes-staged.jsonl'), 'utf8').trim());
    expect(row.tags).toContain('kuratiert');
    expect(row.user_id).toBe('8f7be9fd-02e9-47db-a222-2b4b2a032945');
    expect(JSON.stringify(row.content)).not.toMatch(/[–—]/);
    expect(row.id).toBe(noteId(qnoteKey(5)));
    expect(row.metadata.run).toBe(NOTES_RUN_TAG);
    const spec = { sourceType: 'manual', sourceRef: {}, examType: 'pharma', topic: 'x', metadata: {}, extraTags: ['kuratiert'] };
    expect(() => buildRow({ ...good, blocks: [{ type: 'keyfact', text: 'Kontakt a.b@example.com' }] }, spec)).toThrow('PII flag');
    expect(() => buildRow({ ...good, blocks: [{ type: 'keyfact', text: 'Die Prüfung findet im Januar 2027 statt.' }] }, spec)).toThrow(/copy_rule:exam_date/);
    expect(() => buildRow({ ...good, blocks: [{ type: 'keyfact', text: 'Die Prüfung dauert 90 Minuten.' }] }, spec)).toThrow(/copy_rule:exam_format/);
    expect(() => buildRow({ ...good, blocks: [{ type: 'keyfact', text: 'Aus echten Prüfungsfragen destilliert.' }] }, spec)).toThrow(/copy_rule:real_exam_claim/);
    expect(buildRow({ ...good, tags: ['a—b'] }, spec).tags).toContain('a, b');
    for (const t of ['Die Prüfung umfasst 250 Fragen.', 'Anmeldung bis 3. November.', 'Bestehen ab 60 Prozent.', 'Im Herbst findet die Prüfung statt.']) {
      expect(() => buildRow({ ...good, blocks: [{ type: 'keyfact', text: t }] }, spec), t).toThrow(/copy_rule/);
    }
    const files = emitNoteFiles([row], actor, 'notes-batch-0001');
    expect(files.apply).toContain('WHERE NOT EXISTS');
    expect(files.rollback).toContain('DELETE FROM public.notes');
    expect(files.apply).not.toMatch(/[–—]/);
  });

  it('holds a note a rule refused, with its reason', async () => {
    const client = { restGet: async (qy: string) => (qy.startsWith('question_popularity') ? [{ question_id: 5, n: 9 }] : [qrow]), restAll: async () => [] };
    await notesPlan({ client, out, phase: 'qnotes', top: 1 });
    const id = JSON.parse(readFileSync(path.join(out, 'items.jsonl'), 'utf8').trim()).custom_id as string;
    writeResults([result(id, { ...good, blocks: [{ type: 'keyfact', text: 'Mail an user-bdda357b@example.com' }] })]);
    const s = notesStage({ out });
    expect(s.staged).toBe(0);
    expect(JSON.parse(readFileSync(path.join(out, 'held.json'), 'utf8'))[0].reason).toBe('PII flag');
  });
});

describe('generate_mcq_choices.py staging', () => {
  it('stages a valid distractor set as an a07 edit and holds multi-answer and bad outputs', () => {
    const open = (over = {}) => ({ ...kpRow({ id: 50, choices: null, distractors: [], answer: 'Dopamin' }), ...over });
    const rows = [open(), open({ id: 51, answer: 'A | B' }), open({ id: 52, answer: 'Insulin' }), open({ id: 53, question: 'Welche (2 richtige Antworten) trifft zu?' })];
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify({ kind: 'mcq', pilot: false, rows }));
    // fingerprints are computed by the script itself: ask it for the ids first
    const ids = JSON.parse(execFileSync('python3', ['-c', `
import json,sys
sys.path.insert(0,'scripts')
import generate_mcq_choices as g
rows=json.load(open('${out}/snapshot.json'))['rows']
print(json.dumps([g.custom_id(r) for r in rows]))`], { cwd: ROOT, encoding: 'utf8' }));
    const lines = [
      { custom_id: ids[0], type: 'succeeded', stop_reason: 'end_turn', model: 'claude-haiku-5-5', text: JSON.stringify({ distractors: ['Noradrenalin', 'Serotonin', 'Adrenalin', 'Histamin'] }) },
      { custom_id: ids[2], type: 'succeeded', stop_reason: 'end_turn', model: 'claude-haiku-5-5', text: JSON.stringify({ distractors: ['Glukagon', 'Glukagon', 'Cortisol', 'Insulin'] }) },
    ];
    writeFileSync(path.join(out, 'results.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const log = execFileSync('python3', ['scripts/generate_mcq_choices.py', 'stage', '--out', out], { cwd: ROOT, encoding: 'utf8' });
    expect(log).toContain('1 edits');
    const held = JSON.parse(readFileSync(path.join(out, 'held.json'), 'utf8'));
    expect(held.map((h: { reason: string }) => h.reason).sort()).toEqual(['count_hint_not_one', 'duplicate or equal to the answer', 'multi_answer']);
    const dirs = emitDirs(path.join(out, 'edits'), actor);
    expect(dirs[0].edits).toBe(1);
    const e = JSON.parse(readFileSync(path.join(dirs[0].dir, 'edits.json'), 'utf8'));
    expect(e.edits[0].after.choices).toHaveLength(5);
    expect(e.edits[0].after.choices.filter((c: { correct: boolean }) => c.correct)).toHaveLength(1);
    expect(e.refs['50'].needs_reads).toBe(2);
    expect(kmpRow).toBeDefined();
    expect(emitRowEdits).toBeDefined();
  });
});

describe('no code path writes to production or uses OpenAI', () => {
  const files = ['scripts/format-questions.mjs', 'scripts/generate-notes.mjs', 'scripts/generate_mcq_choices.py', ...['lib', 'format', 'notes', 'emit-edits', 'emit-notes'].map((n) => `scripts/content/batch-port/${n}.mjs`)];
  for (const f of files) {
    it(`${f} has no OpenAI, static key or database write`, () => {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      expect(src).not.toMatch(/openai\.com|OPENAI_|api\.anthropic\.com\/v1\/messages(?!\/batches)/i);
      expect(src.replace(/delete env\.ANTHROPIC_API_KEY|k != "ANTHROPIC_API_KEY"|!= "ANTHROPIC_API_KEY"|ANTHROPIC_API_KEY/g, (m) => (/delete|!=/.test(m) ? '' : m))).not.toMatch(/ANTHROPIC_API_KEY/);
      expect(src).not.toMatch(/method:\s*['"](PATCH|POST|PUT|DELETE)['"]/);
      expect(src).not.toMatch(/requests\.(patch|post|put|delete)\(/);
      expect(src).not.toMatch(/Prefer:\s*['"]return=/);
    });
  }
});
