/** Read-only, bounded PostgREST GET snapshot. No apply/upload capability. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { inventory } from './triage.mjs';

export function credentialsFromFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*(.*?)\s*$/u);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
  }
  const base = values.NEXT_PUBLIC_SUPABASE_URL;
  const key = values.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/u.test(base)) throw new Error('Missing or invalid credentials in supplied env file');
  return { base: base.replace(/\/$/u, ''), key };
}

export async function getQuestions({ base, key }, fetcher = fetch) {
  const rows = [];
  let lastId = 0;
  for (let page = 0; page < 100; page++) {
    const url = new URL(`${base}/rest/v1/questions`);
    url.search = new URLSearchParams({ select: '*', order: 'id.asc', id: `gt.${lastId}`, limit: '1000' }).toString();
    const response = await fetcher(url, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Question GET failed: HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Question GET did not return an array');
    if (batch.length === 0) return rows;
    for (const row of batch) {
      if (!Number.isSafeInteger(row.id) || row.id <= lastId) throw new Error('Non-monotonic question snapshot');
      lastId = row.id;
      rows.push(row);
    }
    // The server may cap pages below the requested limit: only an empty page ends pagination.
  }
  throw new Error('Question snapshot exceeded pagination bound');
}

async function main() {
  const [envPath, freezePath, snapshotPath, inventoryPath] = process.argv.slice(2);
  if (!inventoryPath || process.argv.length !== 6) throw new Error('Usage: node snapshot.mjs <env path> <FREEZE.json> <snapshot.json> <inventory.json>');
  const credentials = credentialsFromFile(await readFile(envPath, 'utf8'));
  const freeze = JSON.parse(await readFile(freezePath, 'utf8'));
  const rows = await getQuestions(credentials);
  const snapshot = JSON.stringify(rows, null, 2) + '\n';
  await writeFile(snapshotPath, snapshot, { mode: 0o600 });
  const candidates = inventory(rows, freeze);
  await writeFile(inventoryPath, JSON.stringify({ read_on: new Date().toISOString(), snapshot_sha256: createHash('sha256').update(snapshot).digest('hex'), rows_read: rows.length, candidates }, null, 2) + '\n');
  const counts = {};
  for (const row of candidates) for (const tier of row.tiers) {
    const name = `${tier}:${row.exam_type}`;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  console.log(JSON.stringify({ rows_read: rows.length, candidates: candidates.length, counts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
