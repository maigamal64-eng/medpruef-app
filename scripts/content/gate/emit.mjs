import { execFileSync } from 'node:child_process';
import { PACKAGE, RULES, normalize } from './check.mjs';

// SQL strings are data, never identifiers. E literals also cover a database
// configured with standard_conforming_strings=off. No shell interpolation.
export function literal(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid SQL string');
  return `E'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const ints = (ids) => `ANY(ARRAY[${ids.join(',')}]::int[])`;
function assertFromGuard(guard, ids, mode) {
  return execFileSync(process.execPath, [guard, '--emit-sql-assert', '--package', PACKAGE,
    '--targets', JSON.stringify(ids), '--columns', 'is_active', '--mode', mode],
  { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 }).trimEnd();
}
export function normalizeSql(expression) {
  // The baseline DB function has a different normalization. Inline the gate's
  // exact entity/tag/ASCII rules rather than relying on a mutable DB function.
  let sql = `coalesce(${expression}, '')`;
  for (const [from, to] of [['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ["&#39;", "'"], ['&nbsp;', ' ']]) {
    sql = `replace(${sql}, ${literal(from)}, ${literal(to)})`;
  }
  sql = `regexp_replace(${sql}, '<[^>]+>', ' ', 'g')`;
  for (const [from, to] of [['ä', 'ae'], ['Ä', 'ae'], ['ö', 'oe'], ['Ö', 'oe'], ['ü', 'ue'], ['Ü', 'ue'], ['ß', 'ss'], ['ẞ', 'ss']]) {
    sql = `replace(${sql}, ${literal(from)}, ${literal(to)})`;
  }
  return `btrim(regexp_replace(regexp_replace(lower(${sql}), '[^a-z0-9 ]+', ' ', 'g'), ${literal('[[:space:]]+')}, ' ', 'g'))`;
}
function gramsSql(expression) {
  return `(SELECT DISTINCT array_to_string(w.words[i:i+${RULES.ngram_size - 1}], ' ') AS gram
FROM (SELECT string_to_array(${normalizeSql(expression)}, ' ') AS words) w,
LATERAL generate_series(1, greatest(cardinality(w.words)-${RULES.ngram_size - 1}, 1)) i)`;
}
function liveDuplicates(row, ids) {
  const mine = gramsSql(literal(row.question)); const theirs = gramsSql('d.question');
  return `IF EXISTS (SELECT 1 FROM questions d WHERE d.id <> ${row.id}
    AND (d.content_hash = ${literal(row.content_hash)} OR ${normalizeSql('d.question')} = ${literalNormalized(row.question)})) THEN
    RAISE EXCEPTION 'Activation blocked: duplicate hash for ${row.id}';
  END IF;
  IF EXISTS (SELECT 1 FROM questions d WHERE d.id <> ${row.id}
    AND (d.is_active OR d.id BETWEEN 114259 AND 114657 OR d.source_file ILIKE 'ARCHIVE_ORIGINAL_%' OR d.id = ${ints(ids)})
    AND (SELECT count(*)::numeric FROM ${mine} a JOIN ${theirs} b USING (gram))
        >= ${RULES.overlap_limit} * least((SELECT count(*) FROM ${mine} a), (SELECT count(*) FROM ${theirs} b))) THEN
    RAISE EXCEPTION 'Activation blocked: ngram overlap for ${row.id}';
  END IF;`;
}
// A dollar-quoted DO body is parsed before the E literals inside it. Choose a
// delimiter absent from the entire body so source text cannot close it early.
function doBlock(label, body) {
  let index = 0, delimiter;
  do { delimiter = `$b20_${label}_${index++}$`; } while (body.includes(delimiter));
  return `DO ${delimiter}\n${body}\n${delimiter};`;
}
// Keep normalization in one implementation rather than a second SQL rewriter.
function literalNormalized(text) { return literal(normalize(text)); }

export function emitBatch(batch, rows, results, guardPath, assertionProvider = assertFromGuard) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(batch.batch_id ?? '')) throw new Error('Batch ID must be a lowercase slug, at most 64 characters');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batch.actor?.id ?? '') ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(batch.actor?.email ?? '')) throw new Error('Audit actor UUID and email required');
  if (!rows.length || rows.length > RULES.max_batch || results.length !== rows.length ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      rows.some((row) => !Number.isSafeInteger(row.id) || row.id <= 114657 || row.is_active !== false ||
        !Array.isArray(row.tags) || !row.tags.includes('authored-track-b') || /^ARCHIVE_ORIGINAL_/i.test(row.source_file ?? '')) ||
      results.some((result, i) => !result.pass || result.id !== rows[i].id)) throw new Error('Cannot emit a failed or mismatched gate');
  const ids = rows.map((row) => row.id).sort((a, b) => a - b);
  const after = (row) => ({ ...row, is_active: true });
  // JSON equality preserves option order and every fetched column, including
  // tags. The track-A approval permits only is_active, with no database logging.
  const projection = (row) => `(SELECT jsonb_object_agg(k, to_jsonb(q)->k) FROM jsonb_object_keys(${json(row)}) k)`;
  const header = (mode) => `-- TRACK_B-PKG: ${PACKAGE}
-- TRACK_B-TARGETS: ${JSON.stringify(ids)}
-- TRACK_B-COLUMNS: ["is_active"]
-- TRACK_B-MODE: ${mode}
-- TRACK_B-BATCH: ${batch.batch_id}
-- Evidence label: track-b-activated-${batch.batch_id} (local receipt only).
-- Gate rules v${RULES.version}; emitted only, never applied by this tool.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(114657, 20);
${assertionProvider(guardPath, ids, mode)}
SELECT id FROM questions WHERE id = ${ints(ids)} ORDER BY id FOR UPDATE;
`;
  const images = doBlock('before', `BEGIN
${rows.map((row) => `  IF NOT EXISTS (SELECT 1 FROM questions q WHERE q.id = ${row.id}
    AND (${projection(row)} = ${json(row)} OR ${projection(row)} = ${json(after(row))})) THEN
    RAISE EXCEPTION 'Before image changed or missing for ${row.id}';
  END IF;`).join('\n')}
END;`);
  const checks = doBlock('gate', `BEGIN
${rows.map((row) => liveDuplicates(row, ids)).join('\n')}
END;`);
  const apply = header('activate') + images + '\n' + checks + '\n' + rows.map((row) => `UPDATE questions SET is_active = true
WHERE id = ${ints([row.id])} AND is_active = false;`).join('\n') + '\nCOMMIT;\n';
  const rollback = header('rollback') + images + '\n' + rows.map((row) => `UPDATE questions SET is_active = false
WHERE id = ${ints([row.id])} AND is_active = true;`).join('\n') + '\nCOMMIT;\n';
  const verify = `-- Read-only verification: expect exactly ${rows.length} rows and every boolean true.
BEGIN READ ONLY;
SELECT q.id, q.is_active AS activated,
       CASE q.id ${rows.map((row) => `WHEN ${row.id} THEN ${projection(row)} = ${json(after(row))}`).join(' ')} END AS before_image_preserved
FROM questions q WHERE q.id = ${ints(ids)} ORDER BY q.id;
ROLLBACK;\n`;
  const verifyBefore = `-- Read-only rollback verification: expect exactly ${rows.length} rows and restored=true.
BEGIN READ ONLY;
SELECT q.id, CASE q.id ${rows.map((row) => `WHEN ${row.id} THEN ${projection(row)} = ${json(row)}`).join(' ')} END AS restored
FROM questions q WHERE q.id = ${ints(ids)} ORDER BY q.id;
ROLLBACK;\n`;
  return { apply, rollback, verify, verifyBefore };
}
