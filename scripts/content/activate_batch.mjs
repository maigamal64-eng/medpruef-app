#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReader } from './gate/read-only.mjs';
import { checkBatch, indexCorpus, PACKAGE, RULES, sha256 } from './gate/check.mjs';
import { emitBatch } from './gate/emit.mjs';

export function parseArgs(args) {
  const opts = { dryRun: true };
  const flags = { '--emit': 'emit', '--dry-run': 'dryRun', '--archive-report': 'archiveReport' };
  const values = { '--batch': 'batch', '--env': 'env', '--policy': 'policy', '--guard': 'guard', '--out': 'out', '--fixture': 'fixture' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] in flags) opts[flags[args[i]]] = true;
    else if (args[i] in values && args[i + 1] && !args[i + 1].startsWith('--')) { opts[values[args[i]]] = args[++i]; }
    else throw new Error('Unknown option or missing value');
  }
  if (!opts.policy || (!opts.archiveReport && !opts.batch)) throw new Error('--policy and --batch required (or --archive-report)');
  if (opts.emit && (!opts.guard || !opts.out || opts.archiveReport || args.includes('--dry-run'))) throw new Error('--emit needs --guard and --out; incompatible with --dry-run or --archive-report');
  if (!opts.fixture && !opts.env) throw new Error('--env required for live reads');
  return opts;
}
const loadJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
export async function main(args) {
  const opts = parseArgs(args);
  const policy = await loadJson(opts.policy);
  if (!policy.packages?.[PACKAGE] || !Array.isArray(policy.open_picks) || !Array.isArray(policy.protected?.ids)) throw new Error('Authoritative FREEZE policy required');
  const reader = opts.fixture ? null : await createReader(opts.env);
  const fixture = opts.fixture ? await loadJson(opts.fixture) : null;
  if (fixture && fixture.proof_origin !== 'fixture-only') throw new Error('Offline input must be marked fixture-only');
  const batch = opts.archiveReport ? null : await loadJson(opts.batch);
  if (batch && (!Array.isArray(batch.entries) || !batch.entries.length || batch.entries.length > RULES.max_batch ||
      batch.entries.some((e) => !Number.isSafeInteger(e?.id)))) throw new Error('Batch metadata must have 1 to 50 integer IDs');
  const corpus = fixture ? fixture.rows : await reader.questions('id,question,content_hash,source_file,is_active,tags');
  if (!Array.isArray(corpus)) throw new Error('Corpus must be an array');
  const detailed = fixture ? corpus : await reader.questions('*', opts.archiveReport
    ? { and: '(id.gte.114259,id.lte.114657)' } : { id: `in.(${batch.entries.map((e) => e.id).join(',')})` });
  // Full candidate before images are fetched separately; other rows need only
  // copying/eligibility fields. Avoid transferring every bank explanation.
  for (const row of detailed) {
    const at = corpus.findIndex((c) => c.id === row.id);
    if (at < 0) throw new Error('Candidate corpus changed during read; retry');
    corpus[at] = row;
  }
  let rows; let results;
  if (opts.archiveReport) {
    rows = corpus.filter((row) => row.id >= 114259 && row.id <= 114657);
    if (rows.length !== 399) throw new Error(`Archive read incomplete: expected 399, got ${rows.length}`);
    const index = indexCorpus(corpus);
    results = [];
    for (let i = 0; i < rows.length; i += RULES.max_batch) {
      const chunk = rows.slice(i, i + RULES.max_batch);
      results.push(...checkBatch(chunk, chunk.map((row) => ({ id: row.id, reviews: [], rights_basis: null })), corpus, policy, index));
    }
  } else {
    if (!Array.isArray(batch.entries) || !batch.entries.length || batch.entries.length > RULES.max_batch) throw new Error('Batch metadata must have 1 to 50 entries');
    // Candidates always come from the read corpus. Batch files cannot replace stems or keys.
    rows = batch.entries.map((entry) => {
      if (Object.keys(entry).some((k) => !['id', 'reviews', 'rights_basis'].includes(k))) throw new Error('Unexpected batch entry field');
      const row = corpus.find((row) => row.id === entry.id);
      if (!row) throw new Error(`Candidate ${entry.id} not present in the complete corpus`);
      return row;
    });
    results = checkBatch(rows, batch.entries, corpus, policy);
  }
  const report = { package: PACKAGE, proof_origin: fixture ? 'fixture-only' : 'live-read-only',
    checked_at: new Date().toISOString(), batch_id: batch?.batch_id ?? null,
    corpus_rows: corpus.length, archive_rows: corpus.filter((r) => r.id >= 114259 && r.id <= 114657).length,
    passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length,
    data_rows_written: 0, database_columns: ['is_active'], database_logging: false,
    evidence_label: batch ? `track-b-activated-${batch.batch_id}` : null,
    approval_source: policy.packages[PACKAGE].approval_source, rules: RULES, policy_sha256: sha256(await readFile(opts.policy, 'utf8')), results };
  if (opts.out) {
    await mkdir(opts.out, { recursive: true });
    await writeFile(resolve(opts.out, 'gate-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  if (opts.emit) {
    const scope = policy.packages[PACKAGE];
    if (!scope.data_tables?.includes('questions') || !scope.data_columns?.questions?.includes('is_active') ||
        !scope.approval_source || !Number.isInteger(scope.max_rows) || rows.length > scope.max_rows) {
      throw new Error('Policy does not approve this is_active batch; no SQL emitted');
    }
    if (report.failed) throw new Error('Gate failed; no SQL emitted (see gate-result.json)');
    const sql = emitBatch(batch, rows, results, opts.guard);
    for (const [name, body] of Object.entries({ 'apply.sql': sql.apply, 'rollback.sql': sql.rollback,
      'verify.sql': sql.verify, 'verify-before.sql': sql.verifyBefore,
      'before-images.json': JSON.stringify(rows, null, 2) + '\n' })) {
      await writeFile(resolve(opts.out, name), fixture && name.endsWith('.sql')
        ? '-- FIXTURE-ONLY: local proof, never apply to production.\n' + body : body, { flag: 'wx' });
    }
  }
  // Only IDs and verdicts on stdout; source question content stays in local files.
  console.log(JSON.stringify({ ...report, results: report.results.map(({ id, pass, errors }) => ({ id, pass, errors })) }, null, 2));
  return report.failed ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((exit) => { process.exitCode = exit; })
    .catch((error) => { console.error(`Activation gate: ${error.message}`); process.exitCode = 2; });
}
