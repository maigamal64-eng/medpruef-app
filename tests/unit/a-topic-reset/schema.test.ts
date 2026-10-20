import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-topic-reset proof on a throwaway PostgreSQL 16 cluster
// (npm run test:db:a-topic-reset): 20270112090000 adds progress_resets,
// topic_progress_reset and topic_progress_restore. Counts, archive equality,
// other topics and XP untouched, bookmarks kept, rate limit, two parallel
// presses, merge restore (newer practice wins), RLS and grants, idempotent
// apply, down.sql refuses while resets exist. Opt-in only; never reads a
// connection URL or production env.
const databaseEnabled = process.env.TOPIC_RESET_DATABASE_TESTS === "1";
const PORT = "55483";
let pgBin = "";
function discoverPgBin() {
  if (process.env.TOPIC_RESET_PG_BIN) return resolve(process.env.TOPIC_RESET_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set TOPIC_RESET_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20270112090000_a_topic_reset.sql");
const down = read("scripts/sql/track-a/a-topic-reset/down.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
const psqlArgs = () => ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"];
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", psqlArgs(), text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
function sqlAsync(text: string): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn(join(pgBin, "psql"), psqlArgs(), { env: pgEnv });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", rej);
    child.on("close", (code) => (code === 0 ? res(out.trim()) : rej(new Error(err))));
    child.stdin.end(text);
  });
}
const rows = (text: string) => sql(text).stdout.trim();
const asService = (text: string) => rows(`SET ROLE service_role; ${text}`);
const resetSql = (user: string, topic: string, limit = 10) =>
  `SET ROLE service_role; SELECT public.topic_progress_reset('${user}', 'kenntnispruefung', '${topic}', ${limit})::text;`;
const reset = (user: string, topic: string, limit = 10) => JSON.parse(rows(resetSql(user, topic, limit)));
const restore = (resetId: string, user: string) =>
  JSON.parse(asService(`SELECT public.topic_progress_restore('${resetId}', '${user}', '${ADMIN}', 'admin@medpruf.com', 'learner asked')::text;`));
const count = (text: string) => Number(rows(text));

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const LEARNER = id(1), OTHER = id(2), ADMIN = id(3), RATE = id(4), RACE = id(5), MERGE = id(6), NOFC = id(7);

function seedLearner(user: string) {
  // Augenheilkunde questions 1..5, Dermatologie 6..8, Pharma (other exam) 9.
  sql(`
    INSERT INTO public.answer_history (user_id, question_id, user_answer, is_correct, xp_earned, created_at, client_request_id)
    SELECT '${user}', q, 'A', q % 2 = 0, 10, now() - interval '3 days' + (q || ' minutes')::interval, gen_random_uuid() FROM generate_series(1, 9) q;
    INSERT INTO public.answer_history (user_id, question_id, user_answer, is_correct, xp_earned, created_at)
    VALUES ('${user}', 1, 'B', true, 10, now() - interval '1 day');
    INSERT INTO public.user_question_progress (user_id, question_id, times_seen, times_correct, ease_factor, interval_days, next_review_at, last_seen_at, is_bookmarked)
    SELECT '${user}', q, 2, 1, 2.3, 4, now() + interval '4 days', now() - interval '1 day', q = 2 FROM generate_series(1, 9) q;
    INSERT INTO public.user_topic_strength (user_id, exam_type, topic, answered, correct) VALUES
      ('${user}', 'kenntnispruefung', 'Augenheilkunde', 6, 3), ('${user}', 'kenntnispruefung', 'Dermatologie', 3, 1),
      ('${user}', 'pharma', 'Augenheilkunde', 1, 0);
    INSERT INTO public.flashcard_reviews (user_id, question_id, grade, client_request_id) VALUES
      ('${user}', 3, 2, gen_random_uuid()), ('${user}', 7, 1, gen_random_uuid());
    INSERT INTO public.user_gamification (user_id, total_xp, current_streak, total_questions_answered) VALUES ('${user}', 217, 4, 10);
  `);
}

describe.skipIf(!databaseEnabled)("a-topic-reset changeset on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "topic-reset-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
      CREATE TABLE public.users (id uuid PRIMARY KEY, email text, role text DEFAULT 'user');
      CREATE TABLE public.questions (id integer PRIMARY KEY, exam_type text, topic text, is_active boolean DEFAULT true);
      CREATE TABLE public.answer_history (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
        question_id integer REFERENCES public.questions(id), user_answer text, is_correct boolean, time_spent_ms integer, xp_earned integer DEFAULT 0,
        created_at timestamptz DEFAULT now(), client_request_id uuid);
      CREATE UNIQUE INDEX answer_history_client_request_unique ON public.answer_history (user_id, client_request_id) WHERE client_request_id IS NOT NULL;
      CREATE TABLE public.user_question_progress (id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
        question_id integer REFERENCES public.questions(id), times_seen integer DEFAULT 0, times_correct integer DEFAULT 0, ease_factor double precision DEFAULT 2.5,
        interval_days integer DEFAULT 0, next_review_at timestamptz DEFAULT now(), last_seen_at timestamptz, is_bookmarked boolean DEFAULT false,
        CONSTRAINT user_question_progress_user_id_question_id_key UNIQUE (user_id, question_id));
      CREATE TABLE public.user_topic_strength (user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, exam_type text NOT NULL, topic text NOT NULL,
        answered int NOT NULL DEFAULT 0, correct int NOT NULL DEFAULT 0, last_answered_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, exam_type, topic));
      CREATE TABLE public.flashcard_reviews (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        question_id integer NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE, grade smallint NOT NULL, client_request_id uuid NOT NULL,
        scheduled boolean NOT NULL DEFAULT false, graded boolean NOT NULL DEFAULT false, ease_factor double precision, interval_days integer,
        next_review_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT flashcard_reviews_request_key UNIQUE (user_id, client_request_id));
      CREATE TABLE public.user_gamification (user_id uuid PRIMARY KEY, total_xp int, current_streak int, total_questions_answered int);
      CREATE TABLE public.user_events (id bigserial PRIMARY KEY, user_id text NOT NULL, session_id uuid, event_type text NOT NULL, event_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
      CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.users(id), actor_email text NOT NULL,
        action text NOT NULL, target_type text, target_id uuid, payload jsonb NOT NULL DEFAULT '{}'::jsonb, ip_address inet, user_agent text, created_at timestamptz NOT NULL DEFAULT now());
      INSERT INTO public.users (id, email, role) VALUES ('${LEARNER}', 'l@example.invalid', 'user'), ('${OTHER}', 'o@example.invalid', 'user'),
        ('${ADMIN}', 'admin@medpruf.com', 'admin'), ('${RATE}', 'r@example.invalid', 'user'), ('${RACE}', 'race@example.invalid', 'user'),
        ('${MERGE}', 'm@example.invalid', 'user'), ('${NOFC}', 'n@example.invalid', 'user');
      INSERT INTO public.questions (id, exam_type, topic, is_active) VALUES
        (1, 'kenntnispruefung', 'Augenheilkunde', true), (2, 'kenntnispruefung', 'Augenheilkunde', true), (3, 'kenntnispruefung', 'Augenheilkunde', true),
        (4, 'kenntnispruefung', 'Augenheilkunde', true), (5, 'kenntnispruefung', 'Augenheilkunde', false),
        (6, 'kenntnispruefung', 'Dermatologie', true), (7, 'kenntnispruefung', 'Dermatologie', true), (8, 'kenntnispruefung', 'Dermatologie', true),
        (9, 'pharma', 'Augenheilkunde', true);`);
    for (const u of [LEARNER, OTHER, RATE, RACE, MERGE, NOFC]) seedLearner(u);
    sql(migration);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("applies twice without error", () => {
    expect(sql(migration).status).toBe(0);
  });

  it("is service-role only: RLS on, no anon/authenticated access to the table or functions", () => {
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.progress_resets'::regclass`)).toBe("t");
    expect(rows(`SELECT count(*) FROM pg_policies WHERE tablename = 'progress_resets'`)).toBe("0");
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`SET ROLE ${role}; SELECT count(*) FROM public.progress_resets;`, true).status).not.toBe(0);
      expect(sql(`SET ROLE ${role}; SELECT public.topic_progress_reset('${LEARNER}', 'kenntnispruefung', 'Augenheilkunde');`, true).status).not.toBe(0);
      expect(sql(`SET ROLE ${role}; SELECT public.topic_progress_restore(gen_random_uuid(), '${LEARNER}', '${ADMIN}', 'a@b.c');`, true).status).not.toBe(0);
    }
    expect(rows(`SELECT has_table_privilege('service_role', 'public.progress_resets', 'DELETE')`)).toBe("f");
  });

  let resetId = "";
  let before: { ah: string; uqp: string; uts: string; fc: string } = { ah: "", uqp: "", uts: "", fc: "" };

  it("resets one subject: archives and deletes every progress row, counts match", () => {
    before = {
      ah: rows(`SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM answer_history a WHERE user_id='${LEARNER}' AND question_id <= 5`),
      uqp: rows(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM user_question_progress p WHERE user_id='${LEARNER}' AND question_id <= 5`),
      uts: rows(`SELECT jsonb_agg(to_jsonb(s)) FROM user_topic_strength s WHERE user_id='${LEARNER}' AND exam_type='kenntnispruefung' AND topic='Augenheilkunde'`),
      fc: rows(`SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM flashcard_reviews f WHERE user_id='${LEARNER}' AND question_id <= 5`),
    };
    const out = reset(LEARNER, "Augenheilkunde");
    expect(out.status).toBe("reset");
    resetId = out.reset_id;
    expect(out.counts).toEqual({
      answer_history: 6, user_question_progress: 4, user_question_progress_bookmark_kept: 1,
      user_topic_strength: 1, flashcard_reviews: 1, questions: 5,
    });
    // Gone for this subject, inactive question 5 included.
    expect(count(`SELECT count(*) FROM answer_history WHERE user_id='${LEARNER}' AND question_id <= 5`)).toBe(0);
    expect(count(`SELECT count(*) FROM user_topic_strength WHERE user_id='${LEARNER}' AND exam_type='kenntnispruefung' AND topic='Augenheilkunde'`)).toBe(0);
    expect(count(`SELECT count(*) FROM flashcard_reviews WHERE user_id='${LEARNER}' AND question_id <= 5`)).toBe(0);
    // The bookmark survives with a cleared schedule.
    expect(rows(`SELECT times_seen||','||times_correct||','||interval_days||','||coalesce(next_review_at::text,'null')||','||is_bookmarked FROM user_question_progress WHERE user_id='${LEARNER}' AND question_id=2`)).toBe("0,0,0,null,true");
    expect(count(`SELECT count(*) FROM user_question_progress WHERE user_id='${LEARNER}' AND question_id <= 5`)).toBe(1);
  });

  it("leaves other subjects, the same topic name in another exam, other learners and XP untouched", () => {
    expect(count(`SELECT count(*) FROM answer_history WHERE user_id='${LEARNER}' AND question_id >= 6`)).toBe(4);
    expect(count(`SELECT count(*) FROM user_question_progress WHERE user_id='${LEARNER}' AND question_id >= 6`)).toBe(4);
    expect(count(`SELECT count(*) FROM user_topic_strength WHERE user_id='${LEARNER}'`)).toBe(2);
    expect(count(`SELECT count(*) FROM user_topic_strength WHERE user_id='${LEARNER}' AND exam_type='pharma' AND topic='Augenheilkunde'`)).toBe(1);
    expect(count(`SELECT count(*) FROM answer_history WHERE user_id='${OTHER}'`)).toBe(10);
    expect(rows(`SELECT total_xp||','||current_streak||','||total_questions_answered FROM user_gamification WHERE user_id='${LEARNER}'`)).toBe("217,4,10");
  });

  it("stores every deleted or changed row in full, plus the event row", () => {
    const archived = JSON.parse(asService(`SELECT archived::text FROM progress_resets WHERE id='${resetId}'`));
    const byId = (a: Array<{ id: string }>) => [...a].sort((x, y) => String(x.id).localeCompare(String(y.id)));
    expect(byId(archived.answer_history)).toEqual(byId(JSON.parse(before.ah)));
    expect(byId(archived.user_question_progress)).toEqual(byId(JSON.parse(before.uqp)));
    expect(archived.user_topic_strength).toEqual(JSON.parse(before.uts));
    expect(archived.flashcard_reviews).toEqual(JSON.parse(before.fc));
    expect(asService(`SELECT array_to_string(question_ids, ',') FROM progress_resets WHERE id='${resetId}'`).split(",").map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(rows(`SELECT event_data->>'reset_id' FROM user_events WHERE user_id='${LEARNER}' AND event_type='topic_progress_reset'`)).toBe(resetId);
  });

  it("answers empty a second time and unknown_topic for a subject that does not exist", () => {
    expect(reset(LEARNER, "Augenheilkunde").status).toBe("empty");
    expect(reset(LEARNER, "Astrologie").status).toBe("unknown_topic");
    expect(count(`SELECT count(*) FROM progress_resets WHERE user_id='${LEARNER}'`)).toBe(1);
  });

  it("restores the archive exactly, once, with an audit row", () => {
    const out = restore(resetId, LEARNER);
    expect(out.status).toBe("restored");
    expect(rows(`SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM answer_history a WHERE user_id='${LEARNER}' AND question_id <= 5`)).toBe(before.ah);
    expect(rows(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM user_question_progress p WHERE user_id='${LEARNER}' AND question_id <= 5`)).toBe(before.uqp);
    expect(rows(`SELECT answered||','||correct FROM user_topic_strength WHERE user_id='${LEARNER}' AND exam_type='kenntnispruefung' AND topic='Augenheilkunde'`)).toBe("6,3");
    expect(rows(`SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM flashcard_reviews f WHERE user_id='${LEARNER}' AND question_id <= 5`)).toBe(before.fc);
    expect(asService(`SELECT restored_at IS NOT NULL AND restored_by='${ADMIN}' FROM progress_resets WHERE id='${resetId}'`)).toBe("t");
    expect(rows(`SELECT payload->>'reset_id' FROM admin_audit_log WHERE action='progress_reset_restore' AND target_id='${LEARNER}'`)).toBe(resetId);
    expect(restore(resetId, LEARNER).status).toBe("already_restored");
    expect(count(`SELECT count(*) FROM admin_audit_log WHERE action='progress_reset_restore'`)).toBe(1);
  });

  it("refuses a reset id of another learner", () => {
    const other = reset(OTHER, "Dermatologie");
    expect(other.status).toBe("reset");
    expect(restore(other.reset_id, LEARNER).status).toBe("not_found");
  });

  it("merges a restore after new practice: history is the union, newer schedule wins, counters add", () => {
    const first = reset(MERGE, "Augenheilkunde");
    expect(first.status).toBe("reset");
    sql(`INSERT INTO answer_history (user_id, question_id, user_answer, is_correct) VALUES ('${MERGE}', 3, 'C', true);
      INSERT INTO user_question_progress (user_id, question_id, times_seen, times_correct, interval_days) VALUES ('${MERGE}', 3, 1, 1, 1);
      INSERT INTO user_topic_strength (user_id, exam_type, topic, answered, correct) VALUES ('${MERGE}', 'kenntnispruefung', 'Augenheilkunde', 1, 1);
      -- A flashcard rating (a23) schedules the kept bookmark row without touching times_seen.
      UPDATE user_question_progress SET interval_days = 2, next_review_at = now() + interval '2 days' WHERE user_id='${MERGE}' AND question_id = 2;`);
    const out = restore(first.reset_id, MERGE);
    expect(out.status).toBe("restored");
    expect(out.counts.answer_history).toBe(6);
    expect(out.counts.user_question_progress_kept_newer).toBe(2);
    expect(rows(`SELECT interval_days||','||is_bookmarked FROM user_question_progress WHERE user_id='${MERGE}' AND question_id=2`)).toBe("2,true");
    expect(count(`SELECT count(*) FROM answer_history WHERE user_id='${MERGE}' AND question_id <= 5`)).toBe(7);
    expect(rows(`SELECT times_seen||','||interval_days FROM user_question_progress WHERE user_id='${MERGE}' AND question_id=3`)).toBe("1,1");
    expect(rows(`SELECT times_seen FROM user_question_progress WHERE user_id='${MERGE}' AND question_id=1`)).toBe("2");
    expect(rows(`SELECT answered||','||correct FROM user_topic_strength WHERE user_id='${MERGE}' AND exam_type='kenntnispruefung' AND topic='Augenheilkunde'`)).toBe("7,4");
  });

  it("enforces the daily limit under the learner lock", () => {
    expect(reset(RATE, "Augenheilkunde", 1).status).toBe("reset");
    expect(reset(RATE, "Dermatologie", 1).status).toBe("rate_limited");
    expect(count(`SELECT count(*) FROM answer_history WHERE user_id='${RATE}' AND question_id BETWEEN 6 AND 8`)).toBe(3);
  });

  it("two parallel presses: one reset, one empty", async () => {
    const results = await Promise.all([sqlAsync(resetSql(RACE, "Augenheilkunde")), sqlAsync(resetSql(RACE, "Augenheilkunde"))]);
    const statuses = results.map((r) => JSON.parse(r).status).sort();
    expect(statuses).toEqual(["empty", "reset"]);
    expect(count(`SELECT count(*) FROM progress_resets WHERE user_id='${RACE}'`)).toBe(1);
  });

  it("works without the flashcard_reviews table", () => {
    sql(`DROP TABLE public.flashcard_reviews;`);
    const out = reset(NOFC, "Dermatologie");
    expect(out.status).toBe("reset");
    expect(out.counts.flashcard_reviews).toBe(0);
    expect(restore(out.reset_id, NOFC).status).toBe("restored");
    expect(count(`SELECT count(*) FROM answer_history WHERE user_id='${NOFC}' AND question_id BETWEEN 6 AND 8`)).toBe(3);
  });

  it("down.sql refuses while resets exist, then drops and re-applies cleanly", () => {
    expect(sql(down, true).status).not.toBe(0);
    expect(rows(`SELECT to_regclass('public.progress_resets') IS NOT NULL`)).toBe("t");
    sql(`DELETE FROM public.progress_resets;`);
    sql(down);
    expect(rows(`SELECT to_regclass('public.progress_resets') IS NULL`)).toBe("t");
    sql(migration);
    expect(rows(`SELECT to_regclass('public.progress_resets') IS NOT NULL`)).toBe("t");
  });
});
