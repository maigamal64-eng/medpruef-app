// Opt-in: A07_DATABASE_TESTS=1 (needs Postgres 16 binaries, LC_ALL set on macOS).
// Isolated throwaway cluster on a private socket with the applied cache-trigger
// migrations (20261110090000, 20261110100000, 20261110110000); never a configured database URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { emitRowEdits, withStem, withTags } from '../../../scripts/content/a07/row-edit.mjs';
import { literal } from '../../../scripts/content/gate/emit.mjs';
// @ts-expect-error untyped fixture module
import { actor, kpRow, kmpRow, rekeyed } from './fixture.mjs';

const database = process.env.A07_DATABASE_TESTS === '1' ? describe : describe.skip;
const bin = process.env.A07_PG_BIN ?? '/opt/homebrew/opt/postgresql@16/bin';
const port = '55437';
let scratch: string | undefined, started = false;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const run = (name: string, args: string[], input?: string) =>
  execFileSync(join(bin, name), args, { input, encoding: 'utf8', env, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
const sql = (text: string) =>
  run('psql', ['-X', '-q', '-A', '-t', '-h', scratch!, '-p', port, '-U', userInfo().username, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], text).trim();
type Row = Record<string, unknown> & { id: number; tags: string[]; choices: unknown[]; distractors: string[] };
function seed(r: Row) {
  sql(`INSERT INTO questions (id, question, choices, answer, distractors, explanation, topic, exam_type, source_file, is_active, tags, content_hash, content_hash_short, ai_explanation, ai_explanation_generated_at)
    VALUES (${r.id}, ${literal(r.question as string)}, ${literal(JSON.stringify(r.choices))}::jsonb, ${literal(r.answer as string)},
    ARRAY[${r.distractors.map(literal).join(',')}]::text[], ${r.explanation === null ? 'NULL' : literal(r.explanation as string)}, ${literal(r.topic as string)},
    ${literal(r.exam_type as string)}, ${literal(r.source_file as string)}, ${r.is_active}, ARRAY[${r.tags.map(literal).join(',')}]::text[],
    ${literal(r.content_hash as string)}, ${literal(r.content_hash_short as string)}, 'cached AI text', now());`);
}
const files = (edits: unknown[]) => emitRowEdits({ batch_id: 'a07-fixture', actor, reason: 'Fixture changeset for the a07 proof', edits, refs: {} });
const row = (id: number) => sql(`SELECT key_revision || ':' || is_active || ':' || coalesce(ai_explanation, '-') || ':' || answer FROM questions WHERE id = ${id};`);

database('a07 row changesets on isolated Postgres 16 with the cache triggers', () => {
  beforeAll(() => {
    scratch = mkdtempSync('/tmp/a07pg-');
    run('initdb', ['-D', join(scratch, 'data'), '--auth=trust', '--encoding=UTF8', '--locale=C']);
    run('pg_ctl', ['-D', join(scratch, 'data'), '-l', join(scratch, 'server.log'), '-o', `-h '' -k ${scratch} -p ${port}`, '-w', 'start']);
    started = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE questions (id integer PRIMARY KEY, question text, choices jsonb, answer text, distractors text[], explanation text, topic text,
        exam_type text, source_file text, is_active boolean, tags text[], content_hash text, content_hash_short text, image_url text, image_urls text[],
        ai_explanation text, ai_explanation_generated_at timestamptz, ai_explanation_lang text, explanation_rating_sum integer DEFAULT 0, explanation_rating_count integer DEFAULT 0);
      CREATE TABLE question_translations (id bigserial PRIMARY KEY, question_id integer REFERENCES questions(id) ON DELETE CASCADE, lang text, field text, translated_text text,
        source_model text, created_at timestamptz DEFAULT now(), UNIQUE (question_id, lang, field));
      CREATE TABLE question_suggestions (id bigserial PRIMARY KEY, status text, created_at timestamptz, resolved_at timestamptz);
      CREATE TABLE admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
        actor_email text NOT NULL, action text NOT NULL, target_type text, target_id uuid, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO users VALUES ('${actor.id}');`);
    for (const m of ['20261110090000_clear_ai_explanation_on_key_change.sql', '20261110100000_explanation_ratings.sql', '20261110110000_adm_q13_content_edit_cache_invalidation.sql'])
      sql(readFileSync(`supabase/migrations/${m}`, 'utf8'));
  }, 120000);
  afterAll(() => {
    if (scratch && started && existsSync(join(scratch, 'data', 'postmaster.pid'))) run('pg_ctl', ['-D', join(scratch, 'data'), '-m', 'immediate', '-w', 'stop']);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }, 60000);
  beforeEach(() => { sql('TRUNCATE admin_audit_log, question_translations, explanation_ratings, questions CASCADE;'); });

  it('re-keys once: key_revision advances, the AI cache clears, verify is true, a replay is a no-op', () => {
    const before = kpRow(); seed(before);
    sql(`INSERT INTO question_translations (question_id, lang, field, translated_text) VALUES (70001, 'en', 'explanation', 'old');`);
    const f = files([{ before, after: withTags(rekeyed(before), { add: ['a07-medic-2read'] }) }]);
    sql(f.apply); sql(f.apply);
    expect(row(70001)).toBe('1:true:-:green triangle');
    expect(sql('SELECT count(*) FROM question_translations;')).toBe('0');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action = 'a07_content_edit';")).toBe('1');
    expect(sql(f.verify)).toBe('70001|t');
  });
  it('rolls back to the exact before image (key_revision moves forward again)', () => {
    const before = kpRow(); seed(before);
    const f = files([{ before, after: rekeyed(before) }]);
    sql(f.apply); sql(f.rollback); sql(f.rollback);
    expect(row(70001)).toBe('2:true:-:blue square');
    expect(sql(f.verifyBefore)).toBe('70001|t');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action = 'a07_content_edit_rollback';")).toBe('1');
  });
  it('aborts the whole file when one row drifted', () => {
    const a = kpRow(), b = kpRow({ id: 70002 }); seed(a); seed(b);
    const f = files([{ before: a, after: rekeyed(a) }, { before: b, after: { ...b, is_active: false } }]);
    sql("UPDATE questions SET explanation = explanation || ' edited' WHERE id = 70002;");
    expect(() => sql(f.apply)).toThrow(/Before image changed for 70002/);
    expect(row(70001)).toBe('0:true:cached AI text:blue square');
    expect(sql('SELECT count(*) FROM admin_audit_log;')).toBe('0');
  });
  it('deactivates without touching the key cache', () => {
    const before = kpRow(); seed(before);
    sql(files([{ before, after: { ...before, is_active: false } }]).apply);
    expect(row(70001)).toBe('0:false:cached AI text:blue square');
    expect(sql("SELECT count(*) FROM admin_audit_log WHERE action = 'a07_content_deactivate';")).toBe('1');
  });
  it('repairs an Innsbruck stem: content hash recomputed, stem translations cleared, key untouched', () => {
    const before = kmpRow(); seed(before);
    sql(`INSERT INTO question_translations (question_id, lang, field, translated_text) VALUES (112001, 'en', 'question', 'old');`);
    const after = withTags(withStem(before, 'Fixture: which statements are true? Bitte ordnen Sie zu.'), { add: ['prefix-fixed-2026-10', 'reimport-override-required'] });
    sql(files([{ before, after }]).apply);
    expect(sql('SELECT key_revision || \':\' || content_hash_short || \':\' || array_to_string(tags, \',\') FROM questions WHERE id = 112001;'))
      .toBe(`0:${after.content_hash_short}:kmp6a,kmp_innsbruck,prefix-fixed-2026-10,reimport-override-required`);
    expect(sql('SELECT count(*) FROM question_translations;')).toBe('0');
  });
  it('refuses to run when a cache trigger is disabled', () => {
    const before = kpRow(); seed(before);
    sql('ALTER TABLE questions DISABLE TRIGGER questions_clear_ai_explanation_on_key_change;');
    try {
      expect(() => sql(files([{ before, after: rekeyed(before) }]).apply)).toThrow(/Trigger questions_clear_ai_explanation_on_key_change missing or disabled/);
      expect(sql(`SELECT count(*) FROM admin_audit_log WHERE payload->>'question_id' = '${before.id}';`)).toBe('0');
    } finally {
      sql('ALTER TABLE questions ENABLE TRIGGER questions_clear_ai_explanation_on_key_change;');
    }
  });
  it('refuses to run when the cache trigger is missing', () => {
    const before = kpRow(); seed(before);
    sql('ALTER TABLE questions DISABLE TRIGGER USER;');
    sql('DROP TRIGGER questions_clear_ai_explanation_on_key_change ON questions;');
    try {
      expect(() => sql(files([{ before, after: rekeyed(before) }]).apply)).toThrow(/Trigger questions_clear_ai_explanation_on_key_change missing/);
    } finally {
      sql(readFileSync('supabase/migrations/20261110090000_clear_ai_explanation_on_key_change.sql', 'utf8'));
      sql(readFileSync('supabase/migrations/20261110110000_adm_q13_content_edit_cache_invalidation.sql', 'utf8'));
      sql('ALTER TABLE questions ENABLE TRIGGER USER;');
    }
  });
});
