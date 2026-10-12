import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a05 schema stack proof on a throwaway PostgreSQL 16 cluster: every
// supabase/migrations/202611*.sql in filename order (b05 cache invalidation,
// ADM-Q13 widening, b18 ratings, b19 senders, b20 activation ledger), the
// combined ADM-Q13 behaviour, client privileges, and the full reverse rollback.
// Opt-in only (test:db:a05); it never reads a connection URL or production env.
const databaseEnabled = process.env.A05_DATABASE_TESTS === "1";
const PORT = "55433";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A05_PG_BIN) return resolve(process.env.A05_PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8", timeout: 10_000 });
  if (config.status === 0 && config.stdout.trim()) return config.stdout.trim();
  throw new Error("PostgreSQL 16 binaries required for test:db:a05. Set A05_PG_BIN or add them to PATH.");
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const migrationNames = readdirSync(resolve("supabase/migrations"))
  .filter((name) => /^202611\d{8}_.+\.sql$/.test(name))
  .sort();
const migrations = migrationNames.map((name) => ({ name, text: read(`supabase/migrations/${name}`) }));
const fixture = read("scripts/sql/track-b/a05-data-proof/fixture.sql");
const examRemindersBase = read("supabase/migrations/20260703180000_exam_reminders.sql");
// Reverse order of the forward stack. Each package owns its own down file.
const rollbacks = [
  "scripts/sql/track-b/b20-activation-gate-ledger/20261112090000_down.sql",
  "scripts/sql/track-b/b19-reminders-nudges/20261111100000_down.sql",
  "scripts/sql/track-b/b19-reminders-nudges/20261111090000_down.sql",
  "scripts/sql/track-b/a05-data-proof/20261110110000_down.sql",
  "scripts/sql/track-b/b18-learner-plumbing/20261110100000_down.sql",
  "scripts/sql/track-b/b05-key-change-trigger/rollback.sql",
].map(read);

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };

function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 30_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const applyStack = () => { for (const migration of migrations) sql(migration.text); };
const translations = (id = 1) =>
  rows(`SELECT coalesce(string_agg(field || ':' || lang, ',' ORDER BY field, lang), '') FROM public.question_translations WHERE question_id = ${id};`);
const ai = (id = 1) =>
  rows(`SELECT coalesce(ai_explanation, '<null>') || '|' || key_revision FROM public.questions WHERE id = ${id};`);
const ratings = (id = 1) =>
  rows(`SELECT explanation_rating_sum || '/' || explanation_rating_count || '/' || (SELECT count(*) FROM public.explanation_ratings r WHERE r.question_id = q.id) FROM public.questions q WHERE id = ${id};`);
const schemaShape = () => rows(`SELECT string_agg(x, ';' ORDER BY x) FROM (
  SELECT 'rel:' || c.relname || ':' || c.relkind::text AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'i')
  UNION ALL SELECT 'col:' || table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'fn:' || p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION ALL SELECT 'trg:' || tgrelid::regclass::text || '.' || tgname FROM pg_trigger WHERE NOT tgisinternal
) shape;`);

describe.skipIf(!databaseEnabled)("a05 schema stack on isolated PostgreSQL 16", () => {
  let baseShape = "";

  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a05-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    // No TCP listener: the port only names this cluster's private socket.
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    sql(fixture);
    sql(examRemindersBase);
    sql(`INSERT INTO public.users (id, email) VALUES ('00000000-0000-4000-8000-000000000001', 'learner@example.invalid'),
      ('00000000-0000-4000-8000-000000000002', 'second@example.invalid');
      INSERT INTO public.exam_reminders (email, exam_type) VALUES ('historical@example.invalid', 'all');`);
    baseShape = schemaShape();
    expect(migrationNames).toEqual([
      "20261110090000_clear_ai_explanation_on_key_change.sql",
      "20261110100000_explanation_ratings.sql",
      "20261110110000_adm_q13_content_edit_cache_invalidation.sql",
      "20261111090000_exam_reminder_sends.sql",
      "20261111100000_study_nudge.sql",
      "20261112090000_question_activation_log.sql",
    ]);
    const relation = rows("SELECT relfilenode FROM pg_class WHERE oid = 'public.questions'::regclass;");
    applyStack();
    // Fast constant default: adding key_revision must not rewrite questions.
    expect(rows("SELECT relfilenode FROM pg_class WHERE oid = 'public.questions'::regclass;")).toBe(relation);
  }, 60_000);

  beforeEach(() => {
    sql(`RESET ROLE;
      TRUNCATE public.explanation_ratings, public.question_activation_log, public.question_suggestions,
        public.question_translations, public.questions RESTART IDENTITY CASCADE;
      INSERT INTO public.questions (id, question, answer, choices, explanation, tags, ai_explanation, ai_explanation_generated_at, ai_explanation_lang)
      VALUES (1, 'Old stem', 'Old key', '[{"text":"A","correct":true},{"text":"B","correct":false}]', 'Manual explanation', '{}',
              'Cached explanation', '2026-10-01T00:00:00Z', 'en'),
             (2, 'Other stem', 'Other key', NULL, 'Other explanation', '{}', 'Other cache', '2026-10-01T00:00:00Z', 'de');
      INSERT INTO public.question_translations (question_id, lang, field, translated_text) VALUES
        (1, 'en', 'explanation', 'Manual translation'), (1, 'fr', 'ai_explanation', 'AI translation'),
        (1, 'en', 'question', 'Stem translation'),
        (2, 'en', 'explanation', 'Other manual'), (2, 'fr', 'ai_explanation', 'Other AI'), (2, 'en', 'question', 'Other stem');`);
  });

  afterAll(() => {
    if (running) {
      const stopped = binary("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
      running = false;
      if (stopped.status !== 0) throw new Error(`Local PostgreSQL stop failed: ${stopped.stderr}`);
    }
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  function expectOtherQuestionUntouched() {
    expect(ai(2)).toBe("Other cache|0");
    expect(translations(2)).toBe("ai_explanation:fr,explanation:en,question:en");
  }

  const ALL_TRANSLATIONS = "ai_explanation:fr,explanation:en,question:en";
  const aiMeta = (id = 1) =>
    rows(`SELECT coalesce((ai_explanation_generated_at = '2026-10-01T00:00:00Z')::text, '<null>') || '|' || coalesce(ai_explanation_lang, '<null>') FROM public.questions WHERE id = ${id};`);
  const vote = () => sql(`SET ROLE service_role;
    SELECT public.rate_explanation_once('00000000-0000-4000-8000-000000000001', 1, 1::smallint);
    SELECT public.rate_explanation_once('00000000-0000-4000-8000-000000000002', 1, -1::smallint);`);

  // [name] 2026-10-12 (decision:adm-q13-cache-rule): wording edits keep the saved
  // AI explanation; only answer/choices edits clear it, its votes and its translations.
  it("keeps the AI explanation, its revision, votes and AI translations on a stem wording edit", () => {
    vote();
    expect(ratings()).toBe("0/2/2");
    sql("UPDATE public.questions SET question = 'Old stem, typo fixed' WHERE id = 1;");
    expect(ai()).toBe("Cached explanation|0");
    expect(aiMeta()).toBe("true|en");
    expect(ratings()).toBe("0/2/2");
    expect(translations()).toBe("ai_explanation:fr,explanation:en");
    expectOtherQuestionUntouched();
  });

  it("keeps the AI explanation and revision on a manual explanation edit, clearing only that field's translations", () => {
    vote();
    sql("UPDATE public.questions SET explanation = 'Manual explanation, typo fixed' WHERE id = 1;");
    expect(ai()).toBe("Cached explanation|0");
    expect(aiMeta()).toBe("true|en");
    expect(translations()).toBe("ai_explanation:fr,question:en");
    // b18's own rule (unchanged): the thumbs sit on the manual explanation pane,
    // so replacing that text resets the per-question vote ledger.
    expect(ratings()).toBe("0/0/0");
    expectOtherQuestionUntouched();
  });

  it("clears the AI explanation, its votes and AI translations when the answer changes", () => {
    vote();
    sql("UPDATE public.questions SET answer = 'New key' WHERE id = 1;");
    expect(ai()).toBe("<null>|1");
    expect(aiMeta()).toBe("<null>|<null>");
    expect(ratings()).toBe("0/0/0");
    expect(translations()).toBe("explanation:en,question:en");
    expectOtherQuestionUntouched();
  });

  it("treats a correct-flag flip, an option text edit and an option reorder as key changes", () => {
    const edits = [
      `[{"text":"A","correct":false},{"text":"B","correct":true}]`,
      `[{"text":"A corrected","correct":false},{"text":"B","correct":true}]`,
      `[{"text":"B","correct":true},{"text":"A corrected","correct":false}]`,
    ];
    for (const [index, choices] of edits.entries()) {
      sql(`UPDATE public.questions SET ai_explanation = 'Cache ${index}', ai_explanation_generated_at = now() WHERE id = 1;
        INSERT INTO public.question_translations (question_id, lang, field, translated_text) VALUES (1, 'fr', 'ai_explanation', 'AI ${index}');`);
      sql(`UPDATE public.questions SET choices = '${choices}' WHERE id = 1;`);
      expect(ai()).toBe(`<null>|${index + 1}`);
      expect(translations()).toBe("explanation:en,question:en");
    }
    expectOtherQuestionUntouched();
  });

  it("deletes stale AI translations when the AI text is regenerated, without advancing the revision", () => {
    sql("UPDATE public.questions SET ai_explanation = 'Regenerated', ai_explanation_generated_at = now() WHERE id = 1;");
    expect(ai()).toBe("Regenerated|0");
    expect(translations()).toBe("explanation:en,question:en");
    expectOtherQuestionUntouched();
  });

  it("preserves every cache for tag, topic, activation and same-value updates", () => {
    vote();
    sql(`UPDATE public.questions SET tags = ARRAY['local-proof'], topic = 'Innere Medizin', is_active = false,
      question = question, explanation = explanation, answer = answer,
      choices = '[{"correct":true,"text":"A"},{"correct":false,"text":"B"}]' WHERE id = 1;`);
    expect(ai()).toBe("Cached explanation|0");
    expect(ratings()).toBe("0/2/2");
    expect(translations()).toBe(ALL_TRANSLATIONS);
  });

  it("lets revision-checked writers cache after a wording edit, and rejects them after an answer edit", () => {
    // Wording edits during generation: the revision is unchanged, so the writers still cache.
    sql("UPDATE public.questions SET ai_explanation = NULL, ai_explanation_generated_at = NULL WHERE id = 1;");
    sql("UPDATE public.questions SET question = 'Stem edited during generation', explanation = 'Edited during translation' WHERE id = 1;");
    expect(rows(`UPDATE public.questions SET ai_explanation = 'Built before the wording edit', ai_explanation_generated_at = now()
      WHERE id = 1 AND key_revision = 0 RETURNING id;`)).toBe("1");
    expect(rows("SET ROLE service_role; SELECT public.cache_question_translation_if_current(1, 0, 'explanation', 'Edited during translation', 'fr', 'Fresh', 'local-test');")).toBe("t");
    // Exact-source check: a translation of the replaced wording is still refused.
    expect(rows("SET ROLE service_role; SELECT public.cache_question_translation_if_current(1, 0, 'explanation', 'Manual explanation', 'de', 'Stale', 'local-test');")).toBe("f");
    // Answer edit during generation: the delayed writers are rejected.
    sql("UPDATE public.questions SET answer = 'Edited during generation' WHERE id = 1;");
    expect(rows(`UPDATE public.questions SET ai_explanation = 'Built on the old key', ai_explanation_generated_at = now()
      WHERE id = 1 AND key_revision = 0 RETURNING id;`)).toBe("");
    expect(ai()).toBe("<null>|1");
    expect(rows("SET ROLE service_role; SELECT public.cache_question_translation_if_current(1, 0, 'explanation', 'Edited during translation', 'it', 'Old revision', 'local-test');")).toBe("f");
    expect(translations()).toBe("explanation:fr");
  });

  it("rejects a direct key_revision write, alone or alongside a content edit", () => {
    const statements = ["UPDATE public.questions SET key_revision = 5 WHERE id = 1;",
      "UPDATE public.questions SET key_revision = key_revision - 1, question = 'Sneaky' WHERE id = 1;"];
    for (const [index, statement] of statements.entries()) {
      sql(`UPDATE public.questions SET answer = 'Bump ${index}' WHERE id = 1;`);
      const result = sql(statement, true);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("key_revision is maintained by the cache invalidation trigger");
    }
    expect(rows("SELECT key_revision FROM public.questions WHERE id = 1;")).toBe("2");
  });

  it("lets a non-service editor fix stem wording, but refuses an answer edit that would clear votes (b18 SECURITY INVOKER)", () => {
    // Stem translation cleanup runs with definer rights on the RLS-protected cache.
    sql("SET ROLE content_editor; UPDATE public.questions SET question = 'Editor stem' WHERE id = 1;");
    expect(ai()).toBe("Cached explanation|0");
    expect(translations()).toBe("ai_explanation:fr,explanation:en");
    // Production content writers are service_role (API) or the owner (changesets).
    // A narrower role cannot clear b18 votes, so the whole key edit rolls back.
    const result = sql("SET ROLE content_editor; UPDATE public.questions SET answer = 'Editor key' WHERE id = 1;", true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("permission denied for table explanation_ratings");
    expect(rows("SELECT answer FROM public.questions WHERE id = 1;")).toBe("Old key");
    expect(ai()).toBe("Cached explanation|0");
    expect(translations()).toBe("ai_explanation:fr,explanation:en");
  });

  it("rolls the content edit back when translation cleanup fails", () => {
    sql("ALTER TABLE public.question_translations RENAME TO question_translations_moved;");
    try {
      const result = sql("UPDATE public.questions SET question = 'Must not commit' WHERE id = 1;", true);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('relation "public.question_translations" does not exist');
    } finally {
      sql("ALTER TABLE public.question_translations_moved RENAME TO question_translations;");
    }
    expect(rows("SELECT question FROM public.questions WHERE id = 1;")).toBe("Old stem");
    expect(ai()).toBe("Cached explanation|0");
  });

  it("grants no client role access to any table, view or function the stack adds", () => {
    const leaks = rows(`SELECT coalesce(string_agg(x, ', '), '') FROM (
      SELECT c.relname || ':' || r AS x FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
        unnest(ARRAY['anon', 'authenticated']) r
      WHERE n.nspname = 'public' AND c.relname IN ('explanation_ratings', 'explanation_downvoted_questions',
        'exam_reminder_sends', 'study_nudge_prefs', 'study_nudge_sends', 'question_activation_log', 'question_report_resolve_time')
        AND (has_table_privilege(r, c.oid, 'SELECT') OR has_table_privilege(r, c.oid, 'INSERT')
          OR has_table_privilege(r, c.oid, 'UPDATE') OR has_table_privilege(r, c.oid, 'DELETE'))
      UNION ALL
      SELECT p.oid::regprocedure::text || ':' || r FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
        unnest(ARRAY['anon', 'authenticated']) r
      WHERE n.nspname = 'public' AND has_function_privilege(r, p.oid, 'EXECUTE')
    ) leaked;`);
    expect(leaks).toBe("");
    for (const table of ["explanation_ratings", "exam_reminder_sends", "study_nudge_prefs", "study_nudge_sends", "question_activation_log"]) {
      expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.${table}'::regclass;`)).toBe("t");
    }
    expect(rows("SELECT has_table_privilege('service_role', 'public.question_activation_log', 'UPDATE'), has_table_privilege('service_role', 'public.question_activation_log', 'INSERT');")).toBe("f|t");
  });

  it("reapplies the re-runnable cache migrations without duplicate triggers", () => {
    const triggers = rows("SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.questions'::regclass AND NOT tgisinternal;");
    expect(triggers).toBe("questions_aa_guard_key_revision,questions_clear_ai_explanation_on_key_change,questions_clear_explanation_translations_on_key_change,questions_clear_replaced_explanation_ratings");
    for (const migration of migrations.filter((m) => /clear_ai_explanation|adm_q13|exam_reminder_sends|study_nudge/.test(m.name))) sql(migration.text);
    expect(rows("SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.questions'::regclass AND NOT tgisinternal;")).toBe(triggers);
    expect(ai()).toBe("Cached explanation|0");
    sql("UPDATE public.questions SET question = 'After reapply' WHERE id = 1;");
    expect(ai()).toBe("Cached explanation|0");
    expect(translations()).toBe("ai_explanation:fr,explanation:en");
  });

  it("applies, rolls back to the base schema twice and reapplies cleanly, preserving legacy rating totals", () => {
    sql("UPDATE public.questions SET explanation_rating_sum = 7, explanation_rating_count = 11 WHERE id = 2;");
    sql("SET ROLE service_role; SELECT public.rate_explanation_once('00000000-0000-4000-8000-000000000001', 2, 1::smallint);");
    expect(ratings(2)).toBe("8/12/1");
    for (const rollback of rollbacks) sql(rollback);
    expect(schemaShape()).toBe(baseShape);
    expect(rows("SELECT explanation_rating_sum || '/' || explanation_rating_count FROM public.questions WHERE id = 2;")).toBe("7/11");
    expect(rows("SELECT confirmed FROM public.exam_reminders WHERE email = 'historical@example.invalid';")).toBe("t");
    // An answer edit after rollback no longer touches caches.
    sql("UPDATE public.questions SET answer = 'No trigger' WHERE id = 1;");
    expect(rows("SELECT ai_explanation FROM public.questions WHERE id = 1;")).toBe("Cached explanation");
    // The re-runnable down files are safe to repeat on the rolled-back schema.
    for (const rollback of rollbacks.slice(1, 3)) sql(rollback);
    expect(schemaShape()).toBe(baseShape);
    // Second full cycle: reapply, roll back again, then the final clean reapply.
    applyStack();
    sql("UPDATE public.questions SET answer = 'Second cycle' WHERE id = 1;");
    expect(ai()).toBe("<null>|1");
    for (const rollback of rollbacks) sql(rollback);
    expect(schemaShape()).toBe(baseShape);
    expect(rows("SELECT explanation_rating_sum || '/' || explanation_rating_count FROM public.questions WHERE id = 2;")).toBe("7/11");
    sql(`UPDATE public.questions SET ai_explanation = 'Cached again', ai_explanation_generated_at = now() WHERE id = 1;
      INSERT INTO public.question_translations (question_id, lang, field, translated_text) VALUES (1, 'fr', 'ai_explanation', 'AI again');`);
    applyStack();
    expect(schemaShape()).not.toBe(baseShape);
    expect(rows("SELECT string_agg(tgname, ',' ORDER BY tgname) FROM pg_trigger WHERE tgrelid = 'public.questions'::regclass AND NOT tgisinternal;"))
      .toBe("questions_aa_guard_key_revision,questions_clear_ai_explanation_on_key_change,questions_clear_explanation_translations_on_key_change,questions_clear_replaced_explanation_ratings");
    sql("UPDATE public.questions SET question = 'Wording after reapply', explanation = 'Explanation after reapply' WHERE id = 1;");
    expect(ai()).toBe("Cached again|0");
    expect(translations()).toBe("ai_explanation:fr");
    sql("UPDATE public.questions SET answer = 'Key after reapply' WHERE id = 1;");
    expect(ai()).toBe("<null>|1");
    expect(translations()).toBe("");
  });
});
