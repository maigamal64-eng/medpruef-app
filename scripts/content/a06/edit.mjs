// track-A a06 guarded content-edit changeset (pick-admin-15 A): one UPDATE per
// row on a fixed set of text columns, a before-image guard on the reviewed
// content, an admin_audit_log row with actor, reason and before/after, and an
// exact rollback. Emits SQL only; track-A applies by hand after GO.
// The applied 20261110110000 trigger clears the matching translation cache on
// a stem or explanation edit, so this file does not touch caches itself.
import { literal } from '../gate/emit.mjs';
import { contentHash } from '../gate/check.mjs';
import { doBlock } from './activate.mjs';

export const EDITABLE = Object.freeze(['question', 'explanation', 'content_hash', 'content_hash_short']);
const PINNED = Object.freeze(['id', 'question', 'choices', 'answer', 'explanation', 'source_file', 'topic', 'exam_type',
  'is_active', 'tags', 'content_hash', 'content_hash_short']);
const pin = (row) => Object.fromEntries(PINNED.map((k) => [k, row[k] ?? null]));
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const projection = `jsonb_build_object(${PINNED.map((k) => `${literal(k)}, to_jsonb(q.${k})`).join(', ')})`;

export function validateEdit(edit) {
  const { before, after } = edit;
  if (!Number.isSafeInteger(before?.id) || before.id !== after?.id) throw new Error('Edit needs matching before/after ids');
  const changed = PINNED.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
  if (!changed.length) throw new Error(`Edit ${before.id} changes nothing`);
  const bad = changed.filter((k) => !EDITABLE.includes(k));
  if (bad.length) throw new Error(`Edit ${before.id} changes non-editable columns: ${bad.join(', ')}`);
  if (after.content_hash !== contentHash(after.question)) throw new Error(`Edit ${before.id}: content_hash does not match the stem`);
  if (after.content_hash_short !== after.content_hash.slice(0, 12)) throw new Error(`Edit ${before.id}: content_hash_short mismatch`);
  return changed;
}

export function emitEdit({ batch_id: batchId, actor, reason, edits }) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(batchId ?? '')) throw new Error('batch_id must be a lowercase slug');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor?.id ?? '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor?.email ?? '')) throw new Error('Actor UUID and email required');
  if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error('A reason of at least 10 characters is required');
  if (!Array.isArray(edits) || !edits.length || edits.length > 50) throw new Error('1 to 50 edits');
  const changed = edits.map(validateEdit);
  const ids = edits.map((e) => e.before.id).sort((a, b) => a - b);
  if (new Set(ids).size !== ids.length) throw new Error('Repeated edit ids');
  const head = (mode) => `-- A06-EDIT: ${batchId}\n-- A06-MODE: ${mode}\n-- A06-TARGETS: ${JSON.stringify(ids)}\n-- A06-COLUMNS: ${JSON.stringify([...new Set(changed.flat())])} + admin_audit_log\nBEGIN;\nSET LOCAL statement_timeout = '30s';\nSET LOCAL lock_timeout = '5s';\nSELECT id FROM questions WHERE id = ANY(ARRAY[${ids.join(',')}]::int[]) ORDER BY id FOR UPDATE;\n`;
  // doBlock picks a dollar-quote delimiter absent from the body, so row text can never close the block.
  // The applied 20261110110000 trigger clears the stem/explanation translation caches; refuse to edit without it.
  const guard = (label) => doBlock(label, `BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.questions'::regclass AND tgname = 'questions_clear_explanation_translations_on_key_change' AND NOT tgisinternal) THEN\n    RAISE EXCEPTION 'Translation cache trigger missing; apply 20261110110000 first';\n  END IF;\n${edits.map(({ before, after }) => `  IF NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = ${before.id} AND (${projection} = ${json(pin(before))} OR ${projection} = ${json(pin(after))})) THEN\n    RAISE EXCEPTION 'Before image changed for ${before.id}';\n  END IF;`).join('\n')}\nEND;`) + '\n';
  const step = (from, to, action) => edits.map((e, i) => {
    const a = from(e), b = to(e); const cols = changed[i];
    return `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_type, payload)
SELECT ${literal(actor.id)}::uuid, ${literal(actor.email)}, ${literal(action)}, 'question', ${json({ batch: batchId, reason, question_id: a.id,
  before: Object.fromEntries(cols.map((k) => [k, a[k]])), after: Object.fromEntries(cols.map((k) => [k, b[k]])) })}
WHERE EXISTS (SELECT 1 FROM questions q WHERE q.id = ${a.id} AND ${projection} = ${json(pin(a))});
UPDATE questions q SET ${cols.map((k) => `${k} = ${b[k] === null || b[k] === undefined ? 'NULL' : literal(b[k])}`).join(', ')}
WHERE q.id = ${a.id} AND ${projection} = ${json(pin(a))};`;
  }).join('\n');
  const verify = (to, label) => doBlock(label, `BEGIN\n${edits.map((e) => `  IF NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = ${e.before.id} AND ${projection} = ${json(pin(to(e)))}) THEN\n    RAISE EXCEPTION 'Final state mismatch for ${e.before.id}';\n  END IF;`).join('\n')}\nEND;`) + '\n';
  const B = (e) => e.before, A = (e) => e.after;
  return {
    apply: head('edit') + guard('image') + step(B, A, 'a06_content_edit') + '\n' + verify(A, 'final') + 'COMMIT;\n',
    rollback: head('rollback') + guard('image') + step(A, B, 'a06_content_edit_rollback') + '\n' + verify(B, 'restored') + 'COMMIT;\n',
  };
}
