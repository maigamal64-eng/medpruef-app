#!/usr/bin/env node
// Turns staged a07 edits.json files (format-questions, generate_mcq_choices) into apply,
// rollback and verify SQL with the unchanged scripts/content/a07/row-edit.mjs. Emits files
// only; track-A applies one file at a time after the two independent medical reads.
//   node scripts/content/batch-port/emit-edits.mjs --dir <out>/edits --actor <uuid> --actor-email <email>
import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { emitRowEdits } from '../a07/row-edit.mjs';
import { parseArgs, readJson } from './lib.mjs';

export function emitDirs(root, actor) {
  const dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(path.join(root, d.name, 'edits.json'))).map((d) => path.join(root, d.name));
  return dirs.map((dir) => {
    const e = readJson(path.join(dir, 'edits.json'));
    let out;
    // One invalid row aborts its own file only; the other files are still emitted and the failure is reported.
    try { out = emitRowEdits({ batch_id: e.batch_id, actor, reason: e.reason, edits: e.edits, refs: e.refs ?? {}, policy: e.policy ?? {} }); }
    catch (err) { return { dir, batch_id: e.batch_id, edits: e.edits.length, error: err.message }; }
    writeFileSync(path.join(dir, 'apply.sql'), out.apply);
    writeFileSync(path.join(dir, 'rollback.sql'), out.rollback);
    writeFileSync(path.join(dir, 'verify.sql'), out.verify);
    writeFileSync(path.join(dir, 'verify-before.sql'), out.verifyBefore);
    return { dir, batch_id: e.batch_id, edits: e.edits.length };
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (typeof a.dir !== 'string' || typeof a.actor !== 'string' || typeof a['actor-email'] !== 'string') { console.error('usage: --dir <edits dir> --actor <uuid> --actor-email <email>'); process.exit(2); }
  for (const r of emitDirs(a.dir, { id: a.actor, email: a['actor-email'] })) { console.log(r.error ? `${r.batch_id}: NOT EMITTED (${r.error})` : `${r.batch_id}: ${r.edits} edits -> apply/rollback/verify`); if (r.error) process.exitCode = 1; };
}
