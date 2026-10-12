// track-A a07 guarded row changeset (held medical rows and Innsbruck prefix
// repairs). Emits SQL only; track-A applies one file at a time after the per-row
// pick and two medical reads. Never connects to a database.
//
// Differences from a06/edit.mjs (stem/explanation only):
// - a row may also change choices, answer, distractors, tags and is_active
//   (re-key, typo fix in an option, N hint, deactivation),
// - the applied cache triggers do the cache work: an answer/choices change
//   advances key_revision and clears the AI explanation and its votes
//   (20261110090000 + 20261110110000). This file never writes those columns and
//   refuses to run without the triggers,
// - every file is guarded by the exact before-image of the pinned columns;
//   a drifted row aborts the whole transaction,
// - frozen ids are refused, and a protected id (duplicate survivor) can never
//   be deactivated.
import { literal } from '../gate/emit.mjs';
import { contentHash } from '../gate/check.mjs';
import { doBlock } from '../a06/activate.mjs';

export const EDITABLE = Object.freeze(['question', 'choices', 'answer', 'distractors', 'explanation', 'tags', 'is_active',
  'content_hash', 'content_hash_short']);
export const PINNED = Object.freeze(['id', 'question', 'choices', 'answer', 'distractors', 'explanation', 'source_file', 'topic',
  'exam_type', 'is_active', 'tags', 'content_hash', 'content_hash_short']);
const KEY_COLUMNS = Object.freeze(['choices', 'answer']);
const TEXT_COLUMNS = Object.freeze(['question', 'answer', 'explanation']);
export const COUNT_HINT = /\(\s*(\d)\s*richtige/gi;
// U+2014 and U+2013: learner copy carries no dashes of this kind ([name]'s copy rule).
const DASH = /[–—]/;
const pin = (row) => Object.fromEntries(PINNED.map((k) => [k, row[k] ?? null]));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const projection = `jsonb_build_object(${PINNED.map((k) => `${literal(k)}, to_jsonb(q.${k})`).join(', ')})`;
const correctOf = (choices) => (Array.isArray(choices) ? choices.filter((c) => c?.correct === true) : []);

function sqlValue(column, value) {
  if (value === null || value === undefined) return 'NULL';
  if (column === 'choices') return json(value);
  if (column === 'is_active') { if (typeof value !== 'boolean') throw new Error('is_active must be boolean'); return String(value); }
  if (column === 'distractors' || column === 'tags') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`${column} must be a string array`);
    return value.length ? `ARRAY[${value.map(literal).join(',')}]::text[]` : `ARRAY[]::text[]`;
  }
  return literal(value);
}

// Shape rules for the after-state of one row. Returns the changed columns.
export function validateRowEdit(edit, policy = {}) {
  const { before, after } = edit ?? {};
  const frozen = new Set(policy.frozen ?? []), protectedIds = new Set(policy.protected ?? []);
  if (!Number.isSafeInteger(before?.id) || before.id !== after?.id) throw new Error('Edit needs matching before/after ids');
  const id = before.id;
  if (frozen.has(id)) throw new Error(`Edit ${id}: frozen id`);
  const changed = PINNED.filter((k) => !same(before[k], after[k]));
  if (!changed.length) throw new Error(`Edit ${id} changes nothing`);
  const bad = changed.filter((k) => !EDITABLE.includes(k));
  if (bad.length) throw new Error(`Edit ${id} changes non-editable columns: ${bad.join(', ')}`);
  if (before.is_active === true && after.is_active === false && protectedIds.has(id)) throw new Error(`Edit ${id}: protected id cannot be deactivated`);
  if (changed.includes('question') || changed.includes('content_hash') || changed.includes('content_hash_short')) {
    if (after.content_hash !== contentHash(after.question)) throw new Error(`Edit ${id}: content_hash does not match the stem`);
    if (after.content_hash_short !== after.content_hash.slice(0, 12)) throw new Error(`Edit ${id}: content_hash_short mismatch`);
  }
  for (const k of TEXT_COLUMNS) if (changed.includes(k) && DASH.test(after[k] ?? '')) throw new Error(`Edit ${id}: dash character in ${k}`);
  const keyEdit = changed.some((k) => ['choices', 'answer', 'distractors'].includes(k));
  if ((keyEdit || changed.includes('question')) && after.is_active !== false) {
    const choices = after.choices;
    if (!Array.isArray(choices) || choices.length < 2) throw new Error(`Edit ${id}: an active MCQ needs at least two choices`);
    for (const c of choices) {
      if (typeof c?.text !== 'string' || !c.text.trim() || typeof c.correct !== 'boolean') throw new Error(`Edit ${id}: malformed choice`);
      if ('is_correct' in c && c.is_correct !== c.correct) throw new Error(`Edit ${id}: is_correct differs from correct`);
      if (changed.includes('choices') && DASH.test(c.text) && !before.choices?.some((b) => b?.text === c.text)) throw new Error(`Edit ${id}: dash character in a new choice`);
    }
    const correct = correctOf(choices);
    if (!correct.length) throw new Error(`Edit ${id}: no correct choice`);
    // The answer/distractors convention is enforced on rows whose key changes; a stem-only
    // repair leaves older rows' columns as they are.
    if (keyEdit) {
      if (after.answer !== correct.map((c) => c.text).join(' | ')) throw new Error(`Edit ${id}: answer does not list the correct choices`);
      // Innsbruck rows keep an empty distractors column (the renderer reads choices); others list the wrong texts.
      const wrong = (before.distractors ?? []).length ? choices.filter((c) => c.correct !== true).map((c) => c.text) : before.distractors ?? null;
      if (!same(after.distractors, wrong)) throw new Error(`Edit ${id}: distractors do not follow the row's convention`);
    }
    const hints = [...String(after.question ?? '').matchAll(COUNT_HINT)].map((m) => Number(m[1]));
    if (hints.some((n) => n !== correct.length)) throw new Error(`Edit ${id}: stated N differs from the marked answers`);
    if (after.exam_type === 'kenntnispruefung' && correct.length > 1 && !hints.length) throw new Error(`Edit ${id}: multi-answer stem without N`);
  }
  return changed;
}

const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One transaction over 1..50 edits. `refs` (per id) lands in the audit payload
// (pick id, read receipts) so the audit row explains why the row changed.
export function emitRowEdits({ batch_id: batchId, actor, reason, edits, refs = {}, policy = {} }) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(batchId ?? '')) throw new Error('batch_id must be a lowercase slug');
  if (!ACTOR_ID.test(actor?.id ?? '') || !EMAIL.test(actor?.email ?? '')) throw new Error('Actor UUID and email required');
  if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error('A reason of at least 10 characters is required');
  if (!Array.isArray(edits) || !edits.length || edits.length > 50) throw new Error('1 to 50 edits');
  const changed = edits.map((e) => validateRowEdit(e, policy));
  const ids = edits.map((e) => e.before.id);
  if (new Set(ids).size !== ids.length) throw new Error('Repeated edit ids');
  const sorted = [...ids].sort((a, b) => a - b);
  const columns = [...new Set(changed.flat())];
  const head = (mode) => `-- A07-ROWS: ${batchId}\n-- A07-MODE: ${mode}\n-- A07-TARGETS: ${JSON.stringify(sorted)}\n-- A07-COLUMNS: ${JSON.stringify(columns)} + admin_audit_log\n-- Run this file alone. Any drift in a pinned column aborts the whole transaction.\nBEGIN;\nSET LOCAL statement_timeout = '30s';\nSET LOCAL lock_timeout = '5s';\nSELECT id FROM questions WHERE id = ANY(ARRAY[${sorted.join(',')}]::int[]) ORDER BY id FOR UPDATE;\n`;
  const needsKeyTrigger = columns.some((k) => KEY_COLUMNS.includes(k));
  const needsTextTrigger = columns.includes('question') || columns.includes('explanation');
  const trigger = (name, ...must) => `  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.questions'::regclass AND tgname = ${literal(name)} AND NOT tgisinternal${must.map((m) => ` AND pg_get_triggerdef(oid) ILIKE ${literal(`%${m}%`)}`).join('')}) THEN\n    RAISE EXCEPTION 'Trigger ${name} missing; apply 20261110090000 and 20261110110000 first';\n  END IF;`;
  const guards = [
    needsKeyTrigger && trigger('questions_clear_ai_explanation_on_key_change', 'old.answer IS DISTINCT FROM new.answer'),
    needsKeyTrigger && trigger('questions_aa_guard_key_revision'),
    needsTextTrigger && trigger('questions_clear_explanation_translations_on_key_change', 'old.question IS DISTINCT FROM new.question', 'old.explanation IS DISTINCT FROM new.explanation'),
  ].filter(Boolean);
  const guard = (from, to) => doBlock('a07_image', `BEGIN\n${[...guards, ...edits.map((e) => `  IF NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = ${e.before.id} AND (${projection} = ${json(pin(from(e)))} OR ${projection} = ${json(pin(to(e)))})) THEN\n    RAISE EXCEPTION 'Before image changed for ${e.before.id}';\n  END IF;`)].join('\n')}\nEND;`) + '\n';
  const step = (from, to, action) => edits.map((e, i) => {
    const a = from(e), b = to(e), cols = changed[i];
    return `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_type, payload)
SELECT ${literal(actor.id)}::uuid, ${literal(actor.email)}, ${literal(action)}, 'question', ${json({ batch: batchId, reason, question_id: a.id, refs: refs[a.id] ?? null,
  before: Object.fromEntries(cols.map((k) => [k, a[k] ?? null])), after: Object.fromEntries(cols.map((k) => [k, b[k] ?? null])) })}
WHERE EXISTS (SELECT 1 FROM questions q WHERE q.id = ${a.id} AND ${projection} = ${json(pin(a))});
UPDATE questions q SET ${cols.map((k) => `${k} = ${sqlValue(k, b[k])}`).join(', ')}
WHERE q.id = ${a.id} AND ${projection} = ${json(pin(a))};`;
  }).join('\n');
  const verify = (to, label) => doBlock(label, `BEGIN\n${edits.map((e) => `  IF NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = ${e.before.id} AND ${projection} = ${json(pin(to(e)))}) THEN\n    RAISE EXCEPTION 'Final state mismatch for ${e.before.id}';\n  END IF;`).join('\n')}\nEND;`) + '\n';
  const check = (to) => `-- A07-ROWS: ${batchId}\n-- A07-MODE: verify (read-only)\nSELECT q.id, ${projection} = CASE q.id ${edits.map((e) => `WHEN ${e.before.id} THEN ${json(pin(to(e)))}`).join(' ')} END AS matches\nFROM questions q WHERE q.id = ANY(ARRAY[${sorted.join(',')}]::int[]) ORDER BY q.id;\n`;
  const B = (e) => e.before, A = (e) => e.after;
  const action = (e) => e.after.is_active === false && e.before.is_active !== false ? 'deactivate' : 'edit';
  const kinds = new Set(edits.map(action));
  const name = kinds.size === 1 && kinds.has('deactivate') ? 'a07_content_deactivate' : 'a07_content_edit';
  return {
    apply: head('apply') + guard(B, A) + step(B, A, name) + '\n' + verify(A, 'a07_final') + 'COMMIT;\n',
    rollback: head('rollback') + guard(A, B) + step(A, B, `${name}_rollback`) + '\n' + verify(B, 'a07_restored') + 'COMMIT;\n',
    verify: check(A),
    verifyBefore: check(B),
    columns,
  };
}

// After-state helpers used by the builders.
export function withStem(row, question) {
  const content_hash = contentHash(question);
  return { ...row, question, content_hash, content_hash_short: content_hash.slice(0, 12) };
}
export function withTags(row, { add = [], remove = [] } = {}) {
  const tags = (row.tags ?? []).filter((t) => !remove.includes(t));
  for (const t of add) if (!tags.includes(t)) tags.push(t);
  return { ...row, tags };
}
