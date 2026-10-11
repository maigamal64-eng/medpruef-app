/** Prepare guarded apply/verify/rollback files. Never executes SQL or uploads. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateDecisions } from './triage.mjs';

export const TAG = 'track-b-b09-2026-10';
export const BEFORE_COLUMNS = ['question', 'answer', 'choices', 'explanation', 'source_file', 'anki_note_id', 'exam_type', 'is_active', 'image_url', 'image_urls', 'tags'];
const PKG = 'b09-image-items';
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const array = value => value === null ? 'NULL::text[]' : `ARRAY[${value.map(literal).join(',')}]::text[]`;
// JSON containment is insufficient: it permits extra/reordered choice or tag
// elements. Compare the entire relevant object, including ordered arrays.
const matches = state => `jsonb_build_object(${BEFORE_COLUMNS.map(column => `${literal(column)}, q.${column}`).join(', ')}) = ${json(state)}`;

export function expectedStates(rows, triage, base) {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/u.test(base)) throw new Error('Invalid storage base');
  const changed = triage.filter(decision => ['attach', 'deactivate'].includes(decision.disposition));
  if (!changed.length || changed.length > 100) throw new Error('Expected 1 to 100 changes in a batch');
  return changed.map(decision => {
    const row = rows.find(row => row.id === decision.id);
    const before = Object.fromEntries(BEFORE_COLUMNS.map(column => [column, row[column] ?? null]));
    const tags = [...(row.tags ?? [])];
    if (tags.includes(TAG)) throw new Error(`Already tagged target ${row.id}: refresh inventory`);
    const patch = { tags: [...tags, TAG] };
    if (decision.disposition === 'deactivate') {
      patch.is_active = false;
      for (const tag of ['missing_image', 'needs_verified_source_media']) if (!patch.tags.includes(tag)) patch.tags.push(tag);
    } else {
      const media = [...decision.media].sort((a, b) => a.image_index - b.image_index);
      if (media.some(object => object.question_id !== row.id || !/^[a-f0-9]{64}$/u.test(object.sha256) || object.object_path !== `track-b-b09/${row.id}/${object.sha256}.webp` || !object.pixel_equality)) throw new Error(`Invalid image manifest ${row.id}`);
      patch.image_urls = media.map(object => `${base.replace(/\/$/u, '')}/storage/v1/object/public/question-images/${object.object_path}`);
      patch.image_url = patch.image_urls[0];
      patch.tags = patch.tags.filter(tag => !['missing_image', 'needs_verified_source_media'].includes(tag));
    }
    return { id: row.id, exam_type: row.exam_type, reason: decision.reason, before, after: { ...before, ...patch }, patch };
  });
}

function assertStates(states, name, allowOther) {
  const checks = states.map(state => {
    const id = `q.id = ANY(ARRAY[${state.id}])`;
    const expected = `(${matches(state[name])})`;
    const alternate = allowOther ? ` OR (${matches(state[name === 'before' ? 'after' : 'before'])})` : '';
    return `  IF NOT EXISTS (SELECT 1 FROM public.questions q WHERE ${id} AND (${expected}${alternate})) THEN\n    RAISE EXCEPTION 'b09 q${state.id}: stale or missing ${name} image/content state';\n  END IF;`;
  }).join('\n');
  return `DO $b09_state$\nBEGIN\n${checks}\nEND;\n$b09_state$;`;
}

export function changeset(states, frozenAssert, rollback = false) {
  const ids = states.map(state => state.id);
  const columns = [...new Set(states.flatMap(state => Object.keys(state.patch)))].sort();
  const op = rollback ? 'rollback' : 'apply';
  const sql = [`-- TRACK_B-PKG: ${PKG}`, `-- TRACK_B-TARGETS: ${JSON.stringify(ids)}`, `-- TRACK_B-COLUMNS: ${JSON.stringify(columns)}`,
    ...(rollback ? ['-- TRACK_B-MODE: rollback'] : []), '-- Prepared only. track-A must prove dry run, media uploads and medical approval before apply.',
    'BEGIN;', "SET LOCAL lock_timeout = '3s';", "SET LOCAL statement_timeout = '30s';", frozenAssert,
    `SELECT id FROM public.questions WHERE id = ANY(ARRAY[${ids.join(',')}]) ORDER BY id FOR UPDATE;`,
    assertStates(states, rollback ? 'after' : 'before', true),
    "DO $b09_actor$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.users WHERE role = 'admin') THEN RAISE EXCEPTION 'b09: no admin audit actor'; END IF; END; $b09_actor$;" ];
  for (const state of states) {
    const expected = rollback ? state.after : state.before;
    const target = rollback ? state.before : state.after;
    const assignments = Object.keys(state.patch).map(column => {
      const value = target[column];
      return `${column} = ${['tags', 'image_urls'].includes(column) ? array(value) : value === null ? 'NULL' : typeof value === 'boolean' ? String(value) : literal(value)}`;
    });
    // Audit SELECT uses existing admin identity at apply time, never embeds personal data.
    const payload = { question_id: state.id, target_ref: String(state.id), package: PKG, batch: 'b09-01', operation: op, reason: state.reason, before: expected, after: target, prepared_by: 'Codex self-check; independent track-A Medic approval required' };
    sql.push(`INSERT INTO public.admin_audit_log (actor_id, actor_email, action, target_type, payload)\nSELECT actor.id, actor.email, 'track-b_b09_${op}', 'question', ${json(payload)}\nFROM (SELECT id, email FROM public.users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1) actor\nWHERE EXISTS (SELECT 1 FROM public.questions q WHERE q.id = ANY(ARRAY[${state.id}]) AND ${matches(expected)});`);
    sql.push(`UPDATE public.questions q SET ${assignments.join(', ')}\nWHERE q.id = ANY(ARRAY[${state.id}]) AND ${matches(expected)};`);
  }
  sql.push(assertStates(states, rollback ? 'before' : 'after', false), 'COMMIT;');
  return sql.join('\n\n') + '\n';
}

export function verifySql(states) {
  const checks = states.map(state => `SELECT ${state.id} AS id, EXISTS(SELECT 1 FROM public.questions q WHERE q.id = ANY(ARRAY[${state.id}]) AND ${matches(state.after)}) AS matches_expected`).join('\nUNION ALL\n');
  return `BEGIN READ ONLY;\n${checks};\nROLLBACK;\n`;
}

async function main() {
  const [snapshotPath, decisionsPath, freezePath, guardPath, base, output] = process.argv.slice(2);
  if (!output || process.argv.length !== 8) throw new Error('Usage: node prepare.mjs <snapshot> <decisions> <FREEZE> <guard> <storage base> <data output>');
  const rows = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const decisions = JSON.parse(await readFile(decisionsPath, 'utf8'));
  const freeze = JSON.parse(await readFile(freezePath, 'utf8'));
  const triage = validateDecisions(rows, decisions, freeze);
  const states = expectedStates(rows, triage, base);
  const ids = JSON.stringify(states.map(state => state.id));
  const columns = [...new Set(states.flatMap(state => Object.keys(state.patch)))].sort().join(',');
  const assertion = mode => execFileSync(process.execPath, [guardPath, '--emit-sql-assert', '--package', PKG, '--targets', ids, '--columns', columns, '--mode', mode], { encoding: 'utf8', timeout: 30_000 }).trim();
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'apply.sql'), changeset(states, assertion('write')));
  await writeFile(resolve(output, 'rollback.sql'), changeset(states, assertion('rollback'), true));
  await writeFile(resolve(output, 'verify.sql'), verifySql(states));
  await writeFile(resolve(output, 'expected-states.json'), JSON.stringify(states, null, 2) + '\n');
  await writeFile(resolve(output, 'triage.json'), JSON.stringify(triage, null, 2) + '\n');
  console.log(JSON.stringify({ staged_rows: states.length, ids: states.map(state => state.id), writes_executed: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
