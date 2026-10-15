// Shared helpers for the Claude Message Batches port of the three OpenAI content
// scripts (a-content-batch-port, plan.json J8). Pure file in, file out:
//   plan   -> <out>/snapshot.json + <out>/items.jsonl      (database SELECTs only)
//   (model calls only through `node scripts/ai-batch.mjs submit|poll|collect --state <out>`)
//   stage  -> <out>/results.jsonl + snapshot -> staged artifacts (edits.json / notes-staged.jsonl)
//   pilot  -> staged pilot output vs the old outputs -> pilot-report.json / .md
// Nothing here writes to a database: REST access is GET only (`restGet`).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PINNED = Object.freeze(['id', 'question', 'choices', 'answer', 'distractors', 'explanation', 'source_file', 'topic',
  'exam_type', 'is_active', 'tags', 'content_hash', 'content_hash_short']);
export const MODELS = Object.freeze({ SONNET_5_5: 'claude-sonnet-5-5', HAIKU_5_5: 'claude-haiku-5-5' });
export const SYSTEM_USER_ID = '8f7be9fd-02e9-47db-a222-2b4b2a032945'; // MedPrüf Team (notes owner)

export function parseArgs(argv) {
  const a = { mode: argv[0] && !argv[0].startsWith('--') ? argv[0] : 'plan' };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2), next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[k] = true;
    else { a[k] = next; i++; }
  }
  return a;
}

export const sha = (s) => createHash('sha256').update(s).digest('hex');
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const clamp = (s, n) => (s || '').trim().slice(0, n);

// U+2014 / U+2013 never reach learner copy ([name]'s rule; a07 refuses them too).
export function cleanDashes(s) {
  return String(s ?? '').replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2').replace(/\s*[–—]\s*/g, ', ');
}
export const DASH = /[–—]/;
// Formatting-only means identical apart from whitespace: case, digits, signs, punctuation and Greek letters all count.
export const normalize = (s) => (s || '').replace(/\s+/g, '');

export function ensureDir(dir) { mkdirSync(dir, { recursive: true }); return dir; }
export function readJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
export function writeJson(file, value) { ensureDir(path.dirname(file)); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
export function writeJsonl(file, rows) { ensureDir(path.dirname(file)); writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); }

// Latest line per custom_id wins (the runner appends a line per attempt).
export function latestResults(dir) {
  const m = new Map();
  for (const r of readJsonl(path.join(dir, 'results.jsonl'))) m.set(r.custom_id, r);
  return m;
}
export function spentUsd(dir) {
  let micro = 0;
  for (const l of readJsonl(path.join(dir, 'spend.jsonl'))) if (Number.isFinite(Number(l.micro)) && l.micro > 0) micro += Number(l.micro);
  return micro / 1_000_000;
}

// ---- read-only database access (GET only; the service key is never printed) ----
export function readEnv(file = path.join(ROOT, '.env.local')) {
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return env;
}
export function restClient(env = readEnv(), fetchImpl = globalThis.fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (read-only SELECTs).');
  async function restGet(query, range) {
    const res = await fetchImpl(`${url}/rest/v1/${query}`, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(range ? { Range: range, 'Range-Unit': 'items' } : {}) },
    });
    if (!res.ok) throw new Error(`supabase ${res.status} ${query.slice(0, 80)}`);
    return res.json();
  }
  async function restAll(query, page = 1000) {
    const rows = [];
    for (let from = 0; ; from += page) {
      const chunk = await restGet(query, `${from}-${from + page - 1}`);
      rows.push(...chunk);
      if (chunk.length < page) return rows;
    }
  }
  return { restGet, restAll };
}

// ---- batch plumbing ----
export function userItem({ id, model, effort, system, user, maxTokens, schema }) {
  return {
    custom_id: id,
    params: {
      model, effort, max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_format: { type: 'json_schema', schema },
    },
  };
}
// Parse one collected result line: the model text must be one JSON object.
export function parseResult(line) {
  if (!line) return { ok: false, reason: 'no_result' };
  if (line.type !== 'succeeded') return { ok: false, reason: `result_${line.type}` };
  if (line.stop_reason && line.stop_reason !== 'end_turn') return { ok: false, reason: `stop_${line.stop_reason}` };
  let t = String(line.text ?? '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const j = JSON.parse(t);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, reason: 'not_object' };
    return { ok: true, value: j, model: line.model ?? null, stop_reason: line.stop_reason ?? null };
  } catch { return { ok: false, reason: 'invalid_json' }; }
}

// submit / poll / collect / status go through the shared keyless CLI, never a model call here.
export function runBatchCli(mode, state, extra = []) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'ai-batch.mjs'), mode, '--state', state, ...extra], { stdio: 'inherit', cwd: ROOT, env });
  return res.status ?? 2;
}
export function passThrough(a, itemsFile, stateDir) {
  if (!['submit', 'poll', 'collect', 'status'].includes(a.mode)) return null;
  const extra = [];
  if (a.mode === 'submit') {
    extra.push('--items', itemsFile, '--max-usd', String(a['max-usd'] ?? ''));
    if (a.live === true) extra.push('--live');
  }
  return runBatchCli(a.mode, stateDir, extra);
}

// ---- a07 edits.json + the thin emitter around the unchanged row-edit.mjs ----
export const EDITS_PER_FILE = 50;
export function writeEditBatches(outDir, prefix, edits, refs, reason, extra = {}) {
  const dirs = [];
  for (let i = 0; i < edits.length; i += EDITS_PER_FILE) {
    const chunk = edits.slice(i, i + EDITS_PER_FILE);
    const n = String(i / EDITS_PER_FILE + 1).padStart(4, '0');
    const dir = path.join(outDir, 'edits', `${prefix}-${n}`);
    writeJson(path.join(dir, 'edits.json'), {
      batch_id: `${prefix}-${n}`, reason, columns: [...new Set(chunk.flatMap((e) => PINNED.filter((k) => !same(e.before[k], e.after[k]))))],
      refs: Object.fromEntries(chunk.map((e) => [String(e.before.id), refs[e.before.id] ?? null])), edits: chunk, ...extra,
    });
    dirs.push(dir);
  }
  return dirs;
}
