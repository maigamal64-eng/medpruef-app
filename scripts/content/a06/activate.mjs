// track-A a06 activation changeset emitter. Read-only: it reads rows (live
// PostgREST GET or a dated snapshot), runs the b20 gate rules plus track-A
// rules, and writes SQL files. It never connects to a database for writing.
//
// Differences from scripts/content/gate (b20, is_active only):
// - kind "archive" admits ARCHIVE_ORIGINAL rows 114259..114657 (pick-archive-activation A),
// - every activation also writes a reviewer tag and a rights tag (CNT-09), one
//   question_activation_log row and one admin_audit_log row with actor, reason
//   and before/after (pick-admin-15 A),
// - topics must be one of the exam's canonical topics and uncovered subject
//   areas stay inactive (pick-uncovered-topics A).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkBatch, normalize, sha256, RULES } from '../gate/check.mjs';
import { literal, normalizeSql } from '../gate/emit.mjs';

export const REVIEW_TAG = 'medic-2read-a06';
export const RIGHTS_TAG_PREFIX = 'rights:';
export const ARCHIVE_RANGE = Object.freeze([114259, 114657]);
// VIENNA_EXAM_PARTS in src/lib/topics.ts (the ten Vienna topic strings).
export const VIENNA_TOPICS = Object.freeze(['Chirurgische Fächer', 'Innere Medizin', 'Dermatologie und Venerologie',
  'Augenheilkunde', 'Hals-Nasen-Ohrenheilkunde', 'Psychiatrie', 'Notfall- und Intensivmedizin',
  'Frauenheilkunde/Gynäkologie', 'Kinder- und Jugendheilkunde', 'Neurologie']);
// /umfang states these areas are not covered; their rows stay inactive.
export const UNCOVERED_TOPIC = /public health|medizinrecht|ethik|evidenzbasiert|\bebm\b|umwelt|arbeitsmedizin/i;
const ARCHIVE_RELAXED = new Set(['ID_NOT_NEW', 'ARCHIVE', 'NOT_AUTHORED']);

// German labels of the official Stichprobentest fields (STP_FIELDS in src/lib/stp-fields.ts, b21).
export const STP_FIELD_LABELS = Object.freeze(['Innere Medizin', 'Chirurgie', 'Kinderheilkunde', 'Neurologie', 'Gynäkologie',
  'Dermatologie', 'Notfallmedizin', 'Hals-Nasen-Ohrenheilkunde', 'Psychiatrie', 'Augenheilkunde']);

export function canonicalTopics(examType, corpus) {
  if (examType === 'kenntnispruefung') return new Set(VIENNA_TOPICS);
  // Other banks: topics already used by active rows of that bank; Innsbruck also the official STP field labels.
  const topics = new Set(corpus.filter((r) => r.is_active === true && r.exam_type === examType).map((r) => r.topic));
  if (examType === 'kmp_innsbruck') for (const label of STP_FIELD_LABELS) topics.add(label);
  return topics;
}

export function laneAErrors(row, kind, corpus) {
  const errors = [];
  if (kind === 'archive') {
    if (!(row.id >= ARCHIVE_RANGE[0] && row.id <= ARCHIVE_RANGE[1])) errors.push('NOT_ARCHIVE_RANGE');
    if (!/^ARCHIVE_ORIGINAL_[A-Z0-9]+$/.test(row.source_file ?? '')) errors.push('NOT_ARCHIVE_SOURCE');
    if (!Array.isArray(row.tags) || !row.tags.includes('archive-original')) errors.push('NOT_ARCHIVE_TAGGED');
  }
  if (UNCOVERED_TOPIC.test(row.topic ?? '')) errors.push('UNCOVERED_TOPIC');
  if (!canonicalTopics(row.exam_type, corpus).has(row.topic)) errors.push('TOPIC_NOT_CANONICAL');
  if (Array.isArray(row.choices)) {
    const correct = row.choices.filter((c) => c?.correct === true).length;
    if (correct > 3) errors.push('TOO_MANY_CORRECT');
    if (correct > 1 && !/\(\s*\d\s*richtige/i.test(row.question ?? '')) errors.push('MULTI_WITHOUT_N');
  }
  const hasImage = Boolean(row.image_url || (Array.isArray(row.image_urls) && row.image_urls.length));
  if (!hasImage && (/\b(abbildung|siehe bild|abb\.|bild zeigt|ekg zeigt|röntgenbild)\b/i.test(row.question ?? '') ||
      (row.tags ?? []).includes('image-needed'))) errors.push('IMAGE_MISSING');
  return errors;
}

export function checkTrackA(rows, entries, corpus, policy, kind) {
  if (!['authored', 'archive'].includes(kind)) throw new Error('kind must be authored or archive');
  return checkBatch(rows, entries, corpus, policy).map((result, i) => {
    const row = rows[i];
    let errors = result.errors.filter((e) => !(kind === 'archive' && ARCHIVE_RELAXED.has(e)));
    errors = [...new Set([...errors, ...laneAErrors(row, kind, corpus)])];
    return { ...result, kind, pass: errors.length === 0, errors };
  });
}

// Review-pending markers that the two recorded reads resolve.
export const RESOLVED_TAGS = Object.freeze(['needs-second-read', 'medical-review-pending']);
export function afterTags(row, rightsBasis) {
  const tags = (row.tags ?? []).filter((t) => !RESOLVED_TAGS.includes(t));
  for (const t of [REVIEW_TAG, RIGHTS_TAG_PREFIX + rightsBasis]) if (!tags.includes(t)) tags.push(t);
  return tags;
}

const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const ints = (ids) => `ANY(ARRAY[${ids.join(',')}]::int[])`;
const textArray = (tags) => `ARRAY[${tags.map(literal).join(',')}]::text[]`;
function doBlock(label, body) {
  let index = 0, delimiter;
  do { delimiter = `$a06_${label}_${index++}$`; } while (body.includes(delimiter));
  return `DO ${delimiter}\n${body}\n${delimiter};`;
}
// Live recheck at apply time, once per batch: the corpus is normalized a single
// time into indexed temp tables (dropped at commit), then the gate's duplicate
// and 5-gram rules run as joins. A per-row corpus rescan (as in the b20 emitter)
// takes minutes on the full bank and must not run on the production database.
function batchRecheck(rows, ids) {
  const n = RULES.ngram_size - 1;
  const cand = rows.map((row) => `(${row.id}, ${literal(row.content_hash)}, ${literal(normalize(row.question))})`).join(',\n  ');
  return `CREATE TEMP TABLE a06_corpus ON COMMIT DROP AS
SELECT d.id, d.content_hash, ${normalizeSql('d.question')} AS nq,
  (d.is_active OR d.id BETWEEN ${ARCHIVE_RANGE[0]} AND ${ARCHIVE_RANGE[1]} OR d.source_file ILIKE 'ARCHIVE_ORIGINAL_%' OR d.id = ${ints(ids)}) AS ngram_scope
FROM questions d;
CREATE TEMP TABLE a06_grams ON COMMIT DROP AS
SELECT DISTINCT c.id, array_to_string(w.words[i:i+${n}], ' ') AS gram
FROM a06_corpus c, LATERAL (SELECT string_to_array(c.nq, ' ') AS words) w,
LATERAL generate_series(1, greatest(cardinality(w.words)-${n}, 1)) i
WHERE c.ngram_scope AND c.nq <> '';
CREATE INDEX ON a06_grams (gram);
CREATE TEMP TABLE a06_sizes ON COMMIT DROP AS SELECT id, count(*)::numeric AS n FROM a06_grams GROUP BY id;
${doBlock('recheck', `DECLARE hit text;
BEGIN
  SELECT string_agg(DISTINCT c.id::text, ',') INTO hit
  FROM (VALUES
  ${cand}
  ) AS c(id, content_hash, nq)
  JOIN a06_corpus d ON d.id <> c.id AND (d.content_hash = c.content_hash OR d.nq = c.nq);
  IF hit IS NOT NULL THEN RAISE EXCEPTION 'Activation blocked: duplicate hash for %', hit; END IF;
  SELECT string_agg(DISTINCT x.cid::text, ',') INTO hit FROM (
    SELECT a.id AS cid, b.id AS oid, count(*) AS shared
    FROM a06_grams a JOIN a06_grams b ON b.gram = a.gram AND b.id <> a.id
    WHERE a.id = ${ints(ids)}
    GROUP BY a.id, b.id) x
  JOIN a06_sizes sa ON sa.id = x.cid JOIN a06_sizes sb ON sb.id = x.oid
  WHERE x.shared >= ${RULES.overlap_limit} * least(sa.n, sb.n);
  IF hit IS NOT NULL THEN RAISE EXCEPTION 'Activation blocked: ngram overlap for %', hit; END IF;
END;`)}`;
}

// Columns compared in the before image. Volatile caches (ai_explanation*,
// ratings) are excluded so a learner opening an inactive row cannot block it;
// the reviewed content (reviewHash fields) and the activation state are pinned.
export const PINNED = Object.freeze(['id', 'question', 'choices', 'answer', 'explanation', 'source_file', 'topic',
  'exam_type', 'is_active', 'tags', 'image_url', 'image_urls', 'content_hash']);
const pin = (row) => Object.fromEntries(PINNED.map((k) => [k, row[k] ?? null]));
const projection = () => `jsonb_build_object(${PINNED.map((k) => `${literal(k)}, to_jsonb(q.${k})`).join(', ')})`;

export function emitActivation(manifest, rows, results) {
  const { batch_id: batchId, actor, reason, kind } = manifest;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(batchId ?? '')) throw new Error('batch_id must be a lowercase slug');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor?.id ?? '') ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor?.email ?? '')) throw new Error('Actor UUID and email required');
  if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error('A reason of at least 10 characters is required');
  if (!rows.length || rows.length > RULES.max_batch || results.length !== rows.length ||
      results.some((r, i) => !r.pass || r.id !== rows[i].id || r.kind !== kind)) throw new Error('Cannot emit a failed or mismatched gate');
  const ids = rows.map((r) => r.id).sort((a, b) => a - b);
  const entries = new Map(manifest.entries.map((e) => [e.id, e]));
  const before = (row) => pin(row);
  const after = (row) => ({ ...pin(row), is_active: true, tags: afterTags(row, entries.get(row.id).rights_basis.basis) });
  const header = (mode) => `-- A06-BATCH: ${batchId}
-- A06-KIND: ${kind}
-- A06-MODE: ${mode}
-- A06-TARGETS: ${JSON.stringify(ids)}
-- A06-COLUMNS: ["is_active","tags"] + question_activation_log + admin_audit_log
-- Emitted by scripts/content/a06/activate.mjs; track-A applies by hand only after GO.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(114657, 20);
SELECT id FROM questions WHERE id = ${ints(ids)} ORDER BY id FOR UPDATE;
`;
  const images = doBlock('image', `BEGIN
  IF (SELECT count(*) FROM questions WHERE id = ${ints(ids)}) <> ${ids.length} THEN
    RAISE EXCEPTION 'Missing target rows';
  END IF;
${rows.map((row) => `  IF NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = ${row.id}
    AND (${projection()} = ${json(before(row))} OR ${projection()} = ${json(after(row))})) THEN
    RAISE EXCEPTION 'Before image changed for ${row.id}';
  END IF;`).join('\n')}
END;`);
  const gate = batchRecheck(rows, ids);
  const audit = (row, mode) => {
    const e = entries.get(row.id);
    const payload = { batch: batchId, kind, mode, reason, question_id: row.id,
      reviewed_content_sha256: results.find((r) => r.id === row.id).reviewed_content_sha256,
      reviewers: e.reviews.map((r) => r.reviewer), rights_basis: e.rights_basis,
      before: { is_active: mode === 'activate' ? false : true, tags: mode === 'activate' ? before(row).tags : after(row).tags },
      after: { is_active: mode === 'activate', tags: mode === 'activate' ? after(row).tags : before(row).tags } };
    return `INSERT INTO admin_audit_log (actor_id, actor_email, action, target_type, payload)
SELECT ${literal(actor.id)}::uuid, ${literal(actor.email)}, ${literal(mode === 'activate' ? 'a06_content_activation' : 'a06_content_activation_rollback')}, 'question', ${json(payload)}
WHERE EXISTS (SELECT 1 FROM questions q WHERE q.id = ${row.id} AND ${projection()} = ${json(mode === 'activate' ? before(row) : after(row))});`;
  };
  const log = (row) => {
    const e = entries.get(row.id);
    const gateResult = { pass: true, batch: batchId, kind, rules: RULES, errors: [],
      reviewed_content_sha256: results.find((r) => r.id === row.id).reviewed_content_sha256 };
    return `INSERT INTO question_activation_log (batch_id, question_id, gate_result, reviewer, rights_basis)
SELECT ${literal(batchId)}, ${row.id}, ${json(gateResult)}, ${literal(e.reviews.map((r) => r.reviewer).join(' + '))}, ${literal(`${e.rights_basis.basis}: ${e.rights_basis.evidence_ref}`)}
WHERE NOT EXISTS (SELECT 1 FROM question_activation_log l WHERE l.batch_id = ${literal(batchId)} AND l.question_id = ${row.id});`;
  };
  const verifyState = (target, label) => doBlock(label, `BEGIN
${rows.map((row) => `  IF NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = ${row.id} AND ${projection()} = ${json(target(row))}) THEN
    RAISE EXCEPTION 'Final state mismatch for ${row.id}';
  END IF;`).join('\n')}
END;`);
  const apply = header('activate') + images + '\n' + gate + '\n' +
    rows.map((row) => audit(row, 'activate')).join('\n') + '\n' +
    rows.map(log).join('\n') + '\n' +
    rows.map((row) => `UPDATE questions SET is_active = true, tags = ${textArray(after(row).tags)}
WHERE id = ${row.id} AND is_active = false;`).join('\n') + '\n' + verifyState(after, 'final') + '\nCOMMIT;\n';
  // The activation log is append-only by design; a rollback is recorded in admin_audit_log.
  const rollback = header('rollback') + images + '\n' +
    rows.map((row) => audit(row, 'rollback')).join('\n') + '\n' +
    rows.map((row) => `UPDATE questions SET is_active = false, tags = ${textArray(before(row).tags)}
WHERE id = ${row.id} AND is_active = true AND tags = ${textArray(after(row).tags)};`).join('\n') + '\n' +
    verifyState(before, 'restored') + '\nCOMMIT;\n';
  const check = (target, name) => `-- Read-only: expect ${rows.length} rows, every ${name} true.
BEGIN READ ONLY;
SELECT q.id, CASE q.id ${rows.map((row) => `WHEN ${row.id} THEN ${projection()} = ${json(target(row))}`).join(' ')} END AS ${name}
FROM questions q WHERE q.id = ${ints(ids)} ORDER BY q.id;
ROLLBACK;
`;
  return { apply, rollback, verify: check(after, 'activated'), verifyBefore: check(before, 'restored'),
    beforeImages: rows.map(before), afterImages: rows.map(after) };
}

// ---------------------------------------------------------------- CLI
function parseArgs(args) {
  const map = { '--manifest': 'manifest', '--env': 'env', '--snapshot': 'snapshot', '--policy': 'policy', '--out': 'out' };
  const opts = { emit: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--emit') { opts.emit = true; continue; }
    const key = map[args[i]]; if (!key || !args[i + 1]) throw new Error(`Unknown or incomplete option ${args[i]}`);
    opts[key] = args[++i];
  }
  if (!opts.manifest || !opts.policy || !opts.out || Boolean(opts.env) === Boolean(opts.snapshot)) {
    throw new Error('Usage: activate.mjs --manifest m.json --policy FREEZE.json --out dir (--env .env.local | --snapshot rows.json) [--emit]');
  }
  return opts;
}
export async function main(args) {
  const opts = parseArgs(args);
  const load = async (p) => JSON.parse(await readFile(p, 'utf8'));
  const manifest = await load(opts.manifest);
  const policy = await load(opts.policy);
  if (!Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > RULES.max_batch) throw new Error('1 to 50 entries');
  let corpus, origin;
  if (opts.env) {
    const { createReader } = await import('../gate/read-only.mjs');
    corpus = await (await createReader(opts.env)).questions('*');
    origin = 'live-read-only';
  } else {
    const snap = await load(opts.snapshot);
    corpus = snap.rows; origin = `snapshot-staging ${snap.read_on ?? 'undated'}`;
  }
  const rows = manifest.entries.map((e) => {
    const row = corpus.find((r) => r.id === e.id);
    if (!row) throw new Error(`Row ${e.id} not in the corpus`);
    return row;
  });
  const results = checkTrackA(rows, manifest.entries, corpus, policy, manifest.kind);
  const report = { tool: 'scripts/content/a06/activate.mjs', origin, checked_at: new Date().toISOString(), batch_id: manifest.batch_id,
    kind: manifest.kind, rows: rows.length, passed: results.filter((r) => r.pass).length,
    policy_sha256: sha256(await readFile(opts.policy, 'utf8')), results };
  await mkdir(opts.out, { recursive: true });
  await writeFile(resolve(opts.out, 'gate-result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (opts.emit) {
    if (report.passed !== rows.length) throw new Error('Gate failed; no SQL emitted (see gate-result.json)');
    const sql = emitActivation(manifest, rows, results);
    const stamp = origin === 'live-read-only' ? '' : `-- STAGED FROM ${origin}. Re-run with --env right before apply; drift fails closed.\n`;
    for (const [name, body] of Object.entries({ 'apply.sql': stamp + sql.apply, 'rollback.sql': stamp + sql.rollback,
      'verify.sql': sql.verify, 'verify-before.sql': sql.verifyBefore,
      'before-images.json': JSON.stringify(sql.beforeImages, null, 2) + '\n', 'after-images.json': JSON.stringify(sql.afterImages, null, 2) + '\n' })) {
      await writeFile(resolve(opts.out, name), body, { flag: 'wx' });
    }
  }
  console.log(JSON.stringify({ ...report, results: results.map(({ id, pass, errors }) => ({ id, pass, errors })) }, null, 2));
  return report;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
