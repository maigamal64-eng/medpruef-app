// Opt-in: A06_DATABASE_TESTS=1 (needs Postgres 16 binaries, LC_ALL set on macOS).
// Isolated throwaway cluster on a private socket; never a configured database URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { checkTrackA, emitActivation } from '../../../scripts/content/a06/activate.mjs';
import { emitEdit } from '../../../scripts/content/a06/edit.mjs';
import { contentHash } from '../../../scripts/content/gate/check.mjs';
import { literal } from '../../../scripts/content/gate/emit.mjs';
// @ts-expect-error untyped fixture module
import { policy, archiveRow, entry, manifest, actor } from './fixture.mjs';

const database = process.env.A06_DATABASE_TESTS === '1' ? describe : describe.skip;
const bin = process.env.A06_PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin';
const port = '55436';
let scratch: string | undefined, started = false;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const run = (name: string, args: string[], input?: string) =>
  execFileSync(join(bin, name), args, { input, encoding: 'utf8', env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const sql = (text: string) =>
  run('psql', ['-X', '-q', '-A', '-t', '-h', scratch!, '-p', port, '-U', userInfo().username, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], text).trim();
const rows = () => [archiveRow(), archiveRow({ id: 114301, question: 'Fixture archive item two: name the red circle drawn alone on white paper today' })];
function seed(list = rows()) {
  for (const r of list) sql(`INSERT INTO questions (id, question, choices, answer, explanation, topic, exam_type, source_file, is_active, tags, content_hash, image_url, image_urls, ai_explanation)
    VALUES (${r.id}, ${literal(r.question)}, ${literal(JSON.stringify(r.choices))}::jsonb, ${literal(r.answer)}, ${literal(r.explanation)}, ${literal(r.topic)},
    ${literal(r.exam_type)}, ${literal(r.source_file)}, ${r.is_active}, ARRAY[${r.tags.map(literal).join(',')}]::text[], ${literal(r.content_hash)}, NULL, ARRAY[]::text[], NULL);`);
}
const files = (list = rows()) => emitActivation(manifest('archive', list), list, checkTrackA(list, list.map((r: Record<string, unknown>) => entry(r)), list, policy, 'archive'));
const state = () => sql("SELECT string_agg(id || ':' || is_active || ':' || array_to_string(tags, ','), ' ' ORDER BY id) FROM questions;");

database('a06 activation changeset on isolated Postgres 16', () => {
  beforeAll(() => {
    scratch = mkdtempSync('/tmp/a06pg-');
    run('initdb', ['-D', join(scratch, 'data'), '--auth=trust', '--encoding=UTF8', '--locale=C']);
    run('pg_ctl', ['-D', join(scratch, 'data'), '-l', join(scratch, 'server.log'), '-o', `-h '' -k ${scratch} -p ${port}`, '-w', 'start']);
    started = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE questions (id integer PRIMARY KEY, question text, choices jsonb, answer text, explanation text, topic text,
        exam_type text, source_file text, is_active boolean, tags text[], content_hash text, content_hash_short text, image_url text, image_urls text[], ai_explanation text);
      CREATE TABLE admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
        actor_email text NOT NULL, action text NOT NULL, target_type text, target_id uuid, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO users VALUES ('${actor.id}');`);
    sql(readFileSync('supabase/migrations/20261112090000_question_activation_log.sql', 'utf8'));
  }, 120000);
  afterAll(() => {
    if (scratch && started && existsSync(join(scratch, 'data', 'postmaster.pid'))) run('pg_ctl', ['-D', join(scratch, 'data'), '-m', 'immediate', '-w', 'stop']);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }, 60000);
  beforeEach(() => { sql('TRUNCATE question_activation_log, admin_audit_log, questions;'); seed(); });

  it('activates, tags, logs and audits once; a replay is a no-op', () => {
    const f = files();
    sql(f.apply); sql(f.apply);
    expect(state()).toBe('114300:true:archive-original,archive-w1,medic-2read-a06,rights:original-authorship 114301:true:archive-original,archive-w1,medic-2read-a06,rights:original-authorship');
    expect(sql('SELECT count(*) FROM question_activation_log;')).toBe('2');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action='a06_content_activation';")).toBe('2');
    expect(sql("SELECT payload->'before'->>'is_active' || '>' || (payload->'after'->>'is_active') FROM admin_audit_log LIMIT 1;")).toBe('false>true');
    expect(sql(f.verify)).toBe('114300|t\n114301|t');
  });
  it('rolls back to the exact before image, audits the rollback, keeps the append-only log', () => {
    const f = files();
    sql(f.apply); sql(f.rollback); sql(f.rollback);
    expect(state()).toBe('114300:false:archive-original,archive-w1,needs-second-read 114301:false:archive-original,archive-w1,needs-second-read');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action='a06_content_activation_rollback';")).toBe('2');
    expect(sql('SELECT count(*) FROM question_activation_log;')).toBe('2');
    expect(sql(f.verifyBefore)).toBe('114300|t\n114301|t');
  });
  it('refuses the whole batch when one reviewed row drifted, and when a learner-visible duplicate appeared', () => {
    const f = files();
    sql("UPDATE questions SET explanation = explanation || ' edited' WHERE id = 114301;");
    expect(() => sql(f.apply)).toThrow(/Before image changed for 114301/);
    expect(sql('SELECT count(*) FROM questions WHERE is_active;')).toBe('0');
    sql('TRUNCATE question_activation_log, admin_audit_log, questions;'); seed();
    sql(`INSERT INTO questions (id, question, is_active, content_hash, tags) VALUES (70000, ${literal(archiveRow().question + ' x')}, true, 'other', ARRAY[]::text[]);`);
    expect(() => sql(f.apply)).toThrow(/ngram overlap for 114300/);
    sql('TRUNCATE question_activation_log, admin_audit_log, questions;'); seed();
    sql(`INSERT INTO questions (id, question, is_active, content_hash, tags) VALUES (70001, 'unrelated inactive stem', false, ${literal(archiveRow().content_hash)}, ARRAY[]::text[]);`);
    expect(() => sql(f.apply)).toThrow(/duplicate hash for 114300/);
    expect(sql('SELECT count(*) FROM admin_audit_log;')).toBe('0');
  });
  it('edits stem and explanation with audit, replays, rolls back exactly and refuses drift', () => {
    sql(`CREATE OR REPLACE FUNCTION a06_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE OR REPLACE TRIGGER questions_clear_explanation_translations_on_key_change AFTER UPDATE ON questions FOR EACH ROW
        WHEN (OLD.question IS DISTINCT FROM NEW.question OR OLD.explanation IS DISTINCT FROM NEW.explanation) EXECUTE FUNCTION a06_noop();`);
    const before = { ...archiveRow(), content_hash_short: null };
    const q = before.question + ' heute';
    const after = { ...before, question: q, explanation: before.explanation + ' Ergänzt.', content_hash: contentHash(q), content_hash_short: contentHash(q).slice(0, 12) };
    const e = emitEdit({ batch_id: 'a06-edit-db', actor, reason: 'Fixture edit for the a06 proof', edits: [{ before, after }] });
    sql(e.apply); sql(e.apply);
    expect(sql('SELECT question = ' + literal(q) + ' AND content_hash = ' + literal(after.content_hash) + ' FROM questions WHERE id = 114300;')).toBe('t');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action='a06_content_edit';")).toBe('1');
    sql(e.rollback); sql(e.rollback);
    expect(sql('SELECT question = ' + literal(before.question) + ' AND content_hash = ' + literal(before.content_hash) + ' FROM questions WHERE id = 114300;')).toBe('t');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action='a06_content_edit_rollback';")).toBe('1');
    sql("UPDATE questions SET tags = tags || ARRAY['x'] WHERE id = 114300;");
    expect(() => sql(e.apply)).toThrow(/Before image changed for 114300/);
    sql('DROP TRIGGER questions_clear_explanation_translations_on_key_change ON questions;');
  });
  it('a later batch containing an already active row writes no second activation log or audit row', () => {
    sql(files().apply);
    const again = emitActivation({ ...manifest('archive', rows()), batch_id: 'a06-fixture-again' }, rows(), checkTrackA(rows(), rows().map((r: Record<string, unknown>) => entry(r)), rows(), policy, 'archive'));
    sql(again.apply);
    expect(sql('SELECT count(*) FROM question_activation_log;')).toBe('2');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action='a06_content_activation';")).toBe('2');
  });
  it('refuses an edit when the translation cache trigger is missing or is the older answer-only version', () => {
    sql(`CREATE OR REPLACE FUNCTION a06_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE OR REPLACE TRIGGER questions_clear_explanation_translations_on_key_change AFTER UPDATE ON questions FOR EACH ROW
        WHEN (OLD.answer IS DISTINCT FROM NEW.answer) EXECUTE FUNCTION a06_noop();`);
    const old = { ...archiveRow(), content_hash_short: null };
    const e0 = emitEdit({ batch_id: 'a06-edit-db3', actor, reason: 'Fixture edit for the a06 proof', edits: [{ before: old, after: { ...old, explanation: old.explanation + ' X.', content_hash_short: old.content_hash.slice(0, 12) } }] });
    expect(() => sql(e0.apply)).toThrow(/Translation cache trigger missing/);
    sql('DROP TRIGGER questions_clear_explanation_translations_on_key_change ON questions;');
    const before = { ...archiveRow(), content_hash_short: null };
    const e = emitEdit({ batch_id: 'a06-edit-db2', actor, reason: 'Fixture edit for the a06 proof', edits: [{ before, after: { ...before, explanation: before.explanation + ' X.', content_hash_short: before.content_hash.slice(0, 12) } }] });
    expect(() => sql(e.apply)).toThrow(/Translation cache trigger missing/);
  });
  it('a dry run (apply ending in ROLLBACK) leaves nothing behind', () => {
    sql(files().apply.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    expect(sql('SELECT count(*) FROM questions WHERE is_active;') + sql('SELECT count(*) FROM admin_audit_log;')).toBe('00');
  });
});
