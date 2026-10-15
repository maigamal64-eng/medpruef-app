#!/usr/bin/env node
// Apply emitter for staged curated notes (notes-staged.jsonl). Emits SQL only; track-A runs
// one file at a time. Every INSERT is idempotent (same id or same provenance + run tag is
// skipped), the rollback deletes exactly the staged ids that still carry the run tag.
//   node scripts/content/batch-port/emit-notes.mjs --staged <notes-staged.jsonl> --out <dir> --actor <uuid> --actor-email <email>
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { literal } from '../gate/emit.mjs';
import { NOTES_RUN_TAG } from './notes.mjs';
import { SYSTEM_USER_ID, ensureDir, parseArgs, readJsonl } from './lib.mjs';

const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PER_FILE = 100;
const json = (v) => `${literal(JSON.stringify(v))}::jsonb`;
const arr = (a) => (a.length ? `ARRAY[${a.map(literal).join(',')}]::text[]` : 'ARRAY[]::text[]');
const ids = (rows) => `ARRAY[${rows.map((r) => literal(r.id)).join(',')}]::uuid[]`;

export function validateStaged(row) {
  if (row.user_id !== SYSTEM_USER_ID) throw new Error(`note ${row.id}: owner must be the MedPrüf Team user`);
  if (row.metadata?.run !== NOTES_RUN_TAG || row.metadata?.curated !== true) throw new Error(`note ${row.id}: run tag / curated flag missing`);
  if (!row.tags?.includes('kuratiert')) throw new Error(`note ${row.id}: tag kuratiert missing`);
  if (row.visibility !== 'public' || row.is_active !== true) throw new Error(`note ${row.id}: unexpected visibility`);
  if (/[–—]/.test(JSON.stringify(row.content))) throw new Error(`note ${row.id}: dash character`);
}

export function emitNoteFiles(rows, actor, batch) {
  if (!ACTOR_ID.test(actor?.id ?? '') || !EMAIL.test(actor?.email ?? '')) throw new Error('Actor UUID and email required');
  if (!rows.length || rows.length > PER_FILE) throw new Error(`1 to ${PER_FILE} notes per file`);
  rows.forEach(validateStaged);
  const head = (mode) => `-- NOTES-BATCH: ${batch}\n-- NOTES-MODE: ${mode}\n-- NOTES-IDS: ${JSON.stringify(rows.map((r) => r.id))}\n-- Run this file alone.\nBEGIN;\nSET LOCAL statement_timeout = '30s';\nSET LOCAL lock_timeout = '5s';\n`;
  const owner = `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = ${literal(SYSTEM_USER_ID)}::uuid) THEN RAISE EXCEPTION 'MedPrüf Team user missing'; END IF; END $$;\n`;
  const audit = (action) => `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_type, payload) VALUES (${literal(actor.id)}::uuid, ${literal(actor.email)}, ${literal(action)}, 'note', ${json({ batch, run: NOTES_RUN_TAG, note_ids: rows.map((r) => r.id) })});\n`;
  const inserts = rows.map((r) => `INSERT INTO public.notes (id, user_id, source_type, source_ref, title, content, tags, exam_type, topic, metadata, visibility, published_at, is_active, search_text)
SELECT ${literal(r.id)}::uuid, ${literal(r.user_id)}::uuid, ${literal(r.source_type)}, ${json(r.source_ref)}, ${literal(r.title)}, ${json(r.content)}, ${arr(r.tags)}, ${literal(r.exam_type)}, ${literal(r.topic)}, ${json(r.metadata)}, 'public', now(), true, ${literal(r.search_text)}
WHERE NOT EXISTS (SELECT 1 FROM public.notes n WHERE n.id = ${literal(r.id)}::uuid OR (n.user_id = ${literal(r.user_id)}::uuid AND n.source_ref = ${json(r.source_ref)} AND n.metadata->>'run' = ${literal(NOTES_RUN_TAG)}));`).join('\n');
  const final = `DO $$ BEGIN\n${rows.map((r) => `  IF NOT EXISTS (SELECT 1 FROM public.notes n WHERE n.id = ${literal(r.id)}::uuid OR (n.user_id = ${literal(r.user_id)}::uuid AND n.source_ref = ${json(r.source_ref)} AND n.metadata->>'run' = ${literal(NOTES_RUN_TAG)})) THEN RAISE EXCEPTION 'Final state mismatch for ${r.id}'; END IF;`).join('\n')}\nEND $$;\n`;
  return {
    apply: head('apply') + owner + inserts + '\n' + audit('notes_curated_insert') + final + 'COMMIT;\n',
    rollback: head('rollback') + `DELETE FROM public.notes WHERE id = ANY(${ids(rows)}) AND user_id = ${literal(SYSTEM_USER_ID)}::uuid AND metadata->>'run' = ${literal(NOTES_RUN_TAG)};\n` + audit('notes_curated_insert_rollback') + 'COMMIT;\n',
    verify: `-- NOTES-BATCH: ${batch}\n-- NOTES-MODE: verify (read-only)\nSELECT count(*) AS present, ${rows.length} AS expected FROM public.notes WHERE id = ANY(${ids(rows)}) AND metadata->>'run' = ${literal(NOTES_RUN_TAG)} AND visibility = 'public';\n`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.staged || !a.out || !a.actor || !a['actor-email']) { console.error('usage: --staged <notes-staged.jsonl> --out <dir> --actor <uuid> --actor-email <email>'); process.exit(2); }
  const rows = readJsonl(a.staged);
  ensureDir(a.out);
  for (let i = 0; i < rows.length; i += PER_FILE) {
    const n = String(i / PER_FILE + 1).padStart(4, '0');
    const f = emitNoteFiles(rows.slice(i, i + PER_FILE), { id: a.actor, email: a['actor-email'] }, `notes-batch-${n}`);
    for (const k of ['apply', 'rollback', 'verify']) writeFileSync(path.join(a.out, `notes-batch-${n}.${k}.sql`), f[k]);
    console.log(`notes-batch-${n}: ${Math.min(PER_FILE, rows.length - i)} notes`);
  }
}
