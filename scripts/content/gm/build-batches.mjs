#!/usr/bin/env node
// a44: b20 activation batch manifests for the seeded Gerichtsmedizin rows.
//
//   node scripts/content/gm/build-batches.mjs --ids <verify-output.txt> \
//     --actor-id <uuid> --actor-email <email> --out <new dir>
//
// --ids is the psql -A -t output of gm-seed.verify.sql (anki_note_id|id|is_active|content_hash).
// Writes batch-1.json .. batch-3.json (50, 50, 27 rows; the b20 gate caps a batch
// at 50; rows marked held in receipts.json are left out) with both Medic reads and the rights record per row, read from the
// committed receipts.json. The gate (scripts/content/activate_batch.mjs) then
// re-reads every row live and refuses anything that differs from the reviewed
// content. Writes nothing to any database; existing files are never overwritten.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const RECEIPTS = resolve(ROOT, 'reports/master-plan-2026-10-11/gm-delivery/receipts.json');
export const BATCH_SIZE = 50;

export function parseIdMap(text) {
  const map = new Map();
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [anki, id, active, hash] = line.split('|');
    if (!/^\d+$/.test(anki) || !/^\d+$/.test(id) || !['t', 'f'].includes(active) || !/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error(`Unreadable id map line: ${line}`);
    if (map.has(anki)) throw new Error(`Repeated anki_note_id ${anki}`);
    map.set(anki, { id: Number(id), active: active === 't', hash });
  }
  return map;
}

export function buildBatches(receipts, idMap, actor, prefix = 'a44-gm') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor?.id ?? '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor?.email ?? '')) {
    throw new Error('Actor UUID and email of the applying operator required');
  }
  const rows = receipts.rows;
  if (idMap.size !== rows.length) throw new Error(`Id map has ${idMap.size} rows, receipts ${rows.length}: run the seed first`);
  const entries = rows.filter((r) => !r.held).map((r) => {
    const live = idMap.get(String(r.anki_note_id));
    if (!live) throw new Error(`anki_note_id ${r.anki_note_id} missing from the id map`);
    if (live.active) throw new Error(`id ${live.id} is already active`);
    if (live.id <= 114657) throw new Error(`id ${live.id} is not above the archive range`);
    return { id: live.id, reviews: r.reviews, rights_basis: r.rights_basis };
  });
  const batches = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batches.push({ batch_id: `${prefix}-${batches.length + 1}`, actor: { id: actor.id, email: actor.email }, entries: entries.slice(i, i + BATCH_SIZE) });
  }
  return batches;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    const ids = arg('--ids'), out = arg('--out');
    if (!ids || !out) throw new Error('--ids and --out required');
    const batches = buildBatches(JSON.parse(readFileSync(RECEIPTS, 'utf8')), parseIdMap(readFileSync(ids, 'utf8')),
      { id: arg('--actor-id'), email: arg('--actor-email') });
    mkdirSync(out, { recursive: true });
    for (const [i, batch] of batches.entries()) writeFileSync(resolve(out, `batch-${i + 1}.json`), JSON.stringify(batch, null, 1) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ batches: batches.map((b) => ({ batch_id: b.batch_id, rows: b.entries.length })) }));
  } catch (error) {
    console.error(`a44 build-batches: ${error.message}`);
    process.exitCode = 2;
  }
}
