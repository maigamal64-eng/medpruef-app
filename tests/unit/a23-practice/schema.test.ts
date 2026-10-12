import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gradedNext, type Grade } from "@/lib/master-learning/srs";

// a23 proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261222090000 changeset (graded scheduler, interval caps, flashcard review
// kind), its privileges, idempotency and rollback. Opt-in only (test:db:a23);
// never reads a connection URL or production env.
const databaseEnabled = process.env.A23_DATABASE_TESTS === "1";
const PORT = "55443";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A23_PG_BIN) return resolve(process.env.A23_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a23. Set A23_PG_BIN.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261222090000_a23_graded_review.sql");
const fixture = read("scripts/sql/track-a/a23-practice/fixture.sql");
const rollback = read("scripts/sql/track-a/a23-practice/down.sql");
const golden = JSON.parse(read("tests/unit/master-plan/learning/srs-golden.json")) as {
  today: string;
  rows: { ease: number | null; interval: number | null; grade: Grade; exam: string | null; outEase: number; outInterval: number }[];
};
const PRO = "00000000-0000-4000-8000-0000000000d1";
const EXAM = "00000000-0000-4000-8000-0000000000d2";
const CARD = "00000000-0000-4000-8000-0000000000d3";
const STALE = "00000000-0000-4000-8000-0000000000d4";
const req = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

let cluster = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C", TZ: "UTC" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const viennaToday = () => rows(`SELECT (now() AT TIME ZONE 'Europe/Vienna')::date;`);

describe.skipIf(!databaseEnabled)("a23 graded review on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a23-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(migration);
    sql(`
      INSERT INTO public.users (id, exam_date) VALUES
        ('${PRO}', NULL), ('${EXAM}', ((now() AT TIME ZONE 'Europe/Vienna')::date + 10)),
        ('${CARD}', NULL), ('${STALE}', ((now() AT TIME ZONE 'Europe/Vienna')::date - 30));
      INSERT INTO public.questions (id, topic, exam_type) VALUES
        (1, 'HNO', 'kenntnispruefung'), (2, 'HNO', 'kenntnispruefung'), (3, 'Augen', 'kenntnispruefung'),
        (4, 'Augen', 'kenntnispruefung'), (5, 'Augen', 'kenntnispruefung');
      INSERT INTO public.questions (id, topic, exam_type, is_active) VALUES (9, 'HNO', 'kenntnispruefung', false);
    `);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("srs_graded_next reproduces all 960 golden rows and srs.ts", () => {
    const values = golden.rows
      .map((r, i) => `(${i}, ${r.ease ?? "NULL"}::double precision, ${r.interval ?? "NULL"}::integer, ${r.grade}::smallint, ${r.exam ? `'${r.exam}'::date` : "NULL::date"})`)
      .join(",\n");
    const out = rows(`SET ROLE service_role;
      SELECT string_agg(i || ':' || n.ease_factor || ':' || n.interval_days, ',' ORDER BY i)
      FROM (VALUES ${values}) AS g(i, ease, iv, grade, exam)
      CROSS JOIN LATERAL public.srs_graded_next(g.ease, g.iv, g.grade, '${golden.today}'::date, g.exam) n;`);
    const got = out.split(",").map((part) => part.split(":").map(Number));
    expect(got).toHaveLength(960);
    got.forEach(([i, ease, days]) => {
      const row = golden.rows[i];
      expect(days).toBe(row.outInterval);
      expect(ease).toBeCloseTo(row.outEase, 10);
      const ts = gradedNext({ ease: row.ease, intervalDays: row.interval }, row.grade, { todayIso: golden.today, examDate: row.exam });
      expect(ts.intervalDays).toBe(days);
    });
  });

  it("an exam date in the past never caps, in SQL and in srs.ts", () => {
    expect(rows(`SET ROLE service_role; SELECT interval_days FROM public.srs_graded_next(2.5, 30, 2::smallint, '2026-10-12', '2026-09-01');`)).toBe("75");
    expect(gradedNext({ ease: 2.5, intervalDays: 30 }, 2, { todayIso: "2026-10-12", examDate: "2026-09-01" }).intervalDays).toBe(75);
    expect(rows(`SET ROLE service_role; SELECT public.srs_cap_interval(500, '2026-10-12', NULL);`)).toBe("180");
    expect(rows(`SET ROLE service_role; SELECT public.srs_cap_interval(5, '2026-10-12', '2026-10-12');`)).toBe("0");
  });

  it("record_quiz_answer keeps the binary arithmetic and now caps at 180 days and the exam date", () => {
    sql(`SET ROLE service_role; SELECT public.record_quiz_answer('${PRO}', 1, true, 'A', 1000, false, '${req(1)}');`);
    expect(rows(`SELECT ease_factor || ':' || interval_days || ':' || times_seen FROM public.user_question_progress WHERE user_id='${PRO}' AND question_id=1;`)).toBe("2.6:1:1");
    // 170 days x 2.7 would be 459: capped at 180.
    sql(`UPDATE public.user_question_progress SET interval_days = 170 WHERE user_id='${PRO}' AND question_id=1;`);
    sql(`SET ROLE service_role; SELECT public.record_quiz_answer('${PRO}', 1, true, 'A', 1000, false, '${req(2)}');`);
    expect(rows(`SELECT interval_days FROM public.user_question_progress WHERE user_id='${PRO}' AND question_id=1;`)).toBe("180");
    expect(rows(`SELECT (next_review_at::date - now()::date) FROM public.user_question_progress WHERE user_id='${PRO}' AND question_id=1;`)).toBe("180");
    // Exam in 10 days: never later than 8 days out.
    sql(`SET ROLE service_role; SELECT public.record_quiz_answer('${EXAM}', 1, true, 'A', 1000, false, '${req(3)}');
         UPDATE public.user_question_progress SET interval_days = 6 WHERE user_id='${EXAM}' AND question_id=1;
         SELECT public.record_quiz_answer('${EXAM}', 1, true, 'A', 1000, false, '${req(4)}');`);
    expect(rows(`SELECT interval_days FROM public.user_question_progress WHERE user_id='${EXAM}' AND question_id=1;`)).toBe("8");
    // A stale exam date does not cap.
    sql(`SET ROLE service_role; SELECT public.record_quiz_answer('${STALE}', 1, true, 'A', 1000, false, '${req(5)}');
         UPDATE public.user_question_progress SET interval_days = 10 WHERE user_id='${STALE}' AND question_id=1;
         SELECT public.record_quiz_answer('${STALE}', 1, true, 'A', 1000, false, '${req(6)}');`);
    expect(rows(`SELECT interval_days FROM public.user_question_progress WHERE user_id='${STALE}' AND question_id=1;`)).toBe("27");
    // Free (p_is_free) still writes no schedule; a wrong answer is due now.
    sql(`SET ROLE service_role; SELECT public.record_quiz_answer('${PRO}', 2, false, 'B', 1000, true, '${req(7)}');`);
    expect(rows(`SELECT count(*) FROM public.user_question_progress WHERE user_id='${PRO}' AND question_id=2;`)).toBe("0");
    // A retry with the same key is a duplicate and changes nothing.
    const dup = rows(`SET ROLE service_role; SELECT public.record_quiz_answer('${PRO}', 1, true, 'A', 1000, false, '${req(2)}') ->> 'duplicate';`);
    expect(dup).toBe("true");
    expect(rows(`SELECT count(*) FROM public.answer_history WHERE user_id='${PRO}';`)).toBe("3");
  });

  it("record_graded_answer follows srs.ts step by step", () => {
    const grades: Grade[] = [2, 2, 2, 3, 1, 0, 2];
    let state: { ease: number | null; intervalDays: number | null } | null = null;
    grades.forEach((grade, i) => {
      const out = rows(`SET ROLE service_role; SELECT (public.record_graded_answer('${PRO}', 3, ${grade}::smallint, '${req(100 + i)}', false, 'x', 500)) ->> 'intervalDays';`);
      const expected = gradedNext(state, grade, { todayIso: viennaToday(), examDate: null });
      expect(Number(out)).toBe(expected.intervalDays);
      state = { ease: expected.ease, intervalDays: expected.intervalDays };
    });
    expect(rows(`SELECT interval_days FROM public.user_question_progress WHERE user_id='${PRO}' AND question_id=3;`)).toBe("1");
    // Graded answers still write quiz history (good and easy count as right).
    expect(rows(`SELECT count(*) || ':' || sum(CASE WHEN is_correct THEN 1 ELSE 0 END) FROM public.answer_history WHERE user_id='${PRO}' AND question_id=3;`)).toBe("7:5");
  });

  it("record_flashcard_review writes schedule and log only: no history, XP, accuracy or quiz count", () => {
    const before = rows(`SELECT coalesce((SELECT total_xp || ':' || total_questions_answered || ':' || total_correct FROM public.user_gamification WHERE user_id='${CARD}'), 'none');`);
    expect(before).toBe("none");
    const first = rows(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 4, 2::smallint, '${req(200)}', true, true)::text;`);
    const parsed = JSON.parse(first);
    expect(parsed).toMatchObject({ saved: true, duplicate: false, kind: "flashcard", xp: 0, scheduled: true, intervalDays: 1, cardsToday: 1 });
    expect(rows(`SELECT count(*) FROM public.answer_history WHERE user_id='${CARD}';`)).toBe("0");
    expect(rows(`SELECT total_xp || ':' || total_questions_answered || ':' || total_correct || ':' || current_streak || ':' || daily_questions_today FROM public.user_gamification WHERE user_id='${CARD}';`)).toBe("0:0:0:1:0");
    expect(rows(`SELECT times_seen || ':' || times_correct || ':' || interval_days FROM public.user_question_progress WHERE user_id='${CARD}' AND question_id=4;`)).toBe("0:0:1");
    // Second good rating: 6 days; a retry returns the stored interval and changes nothing.
    rows(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 4, 2::smallint, '${req(201)}', true, true);`);
    const retry = JSON.parse(rows(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 4, 2::smallint, '${req(201)}', true, true)::text;`));
    expect(retry).toMatchObject({ duplicate: true, intervalDays: 6, cardsToday: 2 });
    expect(rows(`SELECT count(*) FROM public.flashcard_reviews WHERE user_id='${CARD}';`)).toBe("2");
    // The same key with another grade is refused.
    const conflict = sql(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 4, 0::smallint, '${req(201)}', true, true);`, true);
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toMatch(/IDEMPOTENCY_KEY_CONFLICT/);
    // Without a schedule (free account, flag off) only the log row is written.
    const free = JSON.parse(rows(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 5, 0::smallint, '${req(202)}', false, true)::text;`));
    expect(free).toMatchObject({ scheduled: false, intervalDays: null, cardsToday: 3 });
    expect(rows(`SELECT count(*) FROM public.user_question_progress WHERE user_id='${CARD}' AND question_id=5;`)).toBe("0");
    // Binary flashcard path (graded flag off): good on a new card is 1 day.
    rows(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 1, 3::smallint, '${req(203)}', true, false);`);
    expect(rows(`SELECT ease_factor || ':' || interval_days FROM public.user_question_progress WHERE user_id='${CARD}' AND question_id=1;`)).toBe("2.6:1");
    // Inactive questions and missing keys are refused.
    expect(sql(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 9, 2::smallint, '${req(204)}', true, true);`, true).stderr).toMatch(/QUESTION_UNAVAILABLE/);
    expect(sql(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 4, 2::smallint, NULL, true, true);`, true).stderr).toMatch(/REQUEST_ID_REQUIRED/);
  });

  it("a flashcard review first and a quiz answer later the same day keep one streak day", () => {
    sql(`UPDATE public.user_gamification SET current_streak = 4, longest_streak = 4, last_study_date = (now() AT TIME ZONE 'Europe/Vienna')::date - 1,
           daily_reset_date = (now() AT TIME ZONE 'Europe/Vienna')::date - 1, daily_questions_today = 9 WHERE user_id='${CARD}';`);
    rows(`SET ROLE service_role; SELECT public.record_flashcard_review('${CARD}', 4, 1::smallint, '${req(300)}', true, true);`);
    expect(rows(`SELECT current_streak || ':' || daily_questions_today FROM public.user_gamification WHERE user_id='${CARD}';`)).toBe("5:0");
    sql(`SET ROLE service_role; SELECT public.record_quiz_answer('${CARD}', 2, true, 'A', 1000, false, '${req(301)}');`);
    expect(rows(`SELECT current_streak || ':' || daily_questions_today || ':' || total_questions_answered FROM public.user_gamification WHERE user_id='${CARD}';`)).toBe("5:1:1");
  });

  it("get_mistake_rows: open until two correct answers a day apart since the last miss", () => {
    const M = "00000000-0000-4000-8000-0000000000d5";
    sql(`
      INSERT INTO public.users (id) VALUES ('${M}');
      INSERT INTO public.questions (id, topic, exam_type, is_active) VALUES
        (21, 'HNO', 'kenntnispruefung', true), (22, 'HNO', 'kenntnispruefung', true), (23, 'Augen', 'kenntnispruefung', true),
        (24, 'Augen', 'kenntnispruefung', true), (25, 'HNO', 'kenntnispruefung', false), (26, 'HNO', 'pharma', true);
      INSERT INTO public.answer_history (user_id, question_id, is_correct, created_at) VALUES
        ('${M}', 21, false, '2026-10-01T08:00Z'), ('${M}', 21, true, '2026-10-01T09:00Z'), ('${M}', 21, true, '2026-10-01T20:00Z'),
        ('${M}', 22, false, '2026-10-02T08:00Z'), ('${M}', 22, true, '2026-10-02T09:00Z'), ('${M}', 22, true, '2026-10-03T09:00Z'),
        ('${M}', 23, true, '2026-10-03T08:00Z'),
        ('${M}', 24, true, '2026-09-01T08:00Z'), ('${M}', 24, false, '2026-10-04T08:00Z'), ('${M}', 24, false, '2026-10-05T08:00Z'),
        ('${M}', 25, false, '2026-10-06T08:00Z'),
        ('${M}', 26, false, '2026-10-07T08:00Z');
    `);
    const read = (state: string, extra = "NULL") =>
      rows(`SET ROLE service_role; SELECT coalesce(string_agg(question_id || ':' || is_open || ':' || wrong_count || ':' || is_active || ':' || open_total || '/' || corrected_total, ',' ORDER BY last_wrong_at DESC, question_id DESC), '') FROM public.get_mistake_rows('${M}', ARRAY['kenntnispruefung'], ${extra}, '${state}', 0, 20);`);
    // 21: two correct the same day -> open; 22: second correct 24 h later -> corrected;
    // 23: never missed; 24: two misses, open; 25: inactive but listed; 26: other bank.
    expect(read("open")).toBe("25:true:1:false:3/1,24:true:2:true:3/1,21:true:1:true:3/1");
    expect(read("corrected")).toBe("22:false:1:true:3/1");
    expect(read("all")).toBe("25:true:1:false:3/1,24:true:2:true:3/1,22:false:1:true:3/1,21:true:1:true:3/1");
    expect(read("open", "ARRAY['Augen']")).toBe("24:true:2:true:1/0");
    expect(rows(`SET ROLE service_role; SELECT corrected_at FROM public.get_mistake_rows('${M}', NULL, NULL, 'corrected', 0, 20);`)).toMatch(/^2026-10-03 09:00:00/);
    expect(rows(`SET ROLE service_role; SELECT count(*) FROM public.get_mistake_rows('${M}', NULL, NULL, 'open', 1, 2);`)).toBe("2");
  });

  it("everything is service_role only", () => {
    for (const role of ["anon", "authenticated"]) {
      for (const call of [
        `SELECT public.record_flashcard_review('${CARD}', 4, 2::smallint, '${req(400)}', true, true);`,
        `SELECT public.record_graded_answer('${CARD}', 4, 2::smallint, '${req(401)}', false, 'x', 1);`,
        `SELECT * FROM public.srs_graded_next(2.5, 1, 2::smallint, '2026-10-12', NULL);`,
        `SELECT public.srs_cap_interval(5, '2026-10-12', NULL);`,
        `SELECT count(*) FROM public.flashcard_reviews;`,
        `SELECT * FROM public.get_mistake_rows('${CARD}', NULL, NULL, 'open', 0, 20);`,
      ]) {
        const denied = sql(`SET ROLE ${role}; ${call}`, true);
        expect(denied.status, call).not.toBe(0);
        expect(denied.stderr).toMatch(/permission denied/);
      }
    }
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE relname = 'flashcard_reviews';`)).toBe("t");
  });

  it("re-applies idempotently, rolls back to the uncapped quiz RPC and re-applies", () => {
    sql(migration);
    sql(rollback);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname IN ('srs_graded_next','srs_cap_interval','record_graded_answer','record_flashcard_review','get_mistake_rows');`)).toBe("0");
    expect(rows(`SELECT count(*) FROM pg_class WHERE relname = 'flashcard_reviews';`)).toBe("0");
    // The restored quiz RPC is uncapped again.
    sql(`UPDATE public.user_question_progress SET interval_days = 170, ease_factor = 2.9 WHERE user_id='${PRO}' AND question_id=1;`);
    sql(`SET ROLE service_role; SELECT public.record_quiz_answer('${PRO}', 1, true, 'A', 1000, false, '${req(500)}');`);
    expect(rows(`SELECT interval_days FROM public.user_question_progress WHERE user_id='${PRO}' AND question_id=1;`)).toBe("510");
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname IN ('srs_graded_next','srs_cap_interval','record_graded_answer','record_flashcard_review','get_mistake_rows');`)).toBe("5");
    const denied = sql(`SET ROLE authenticated; SELECT public.record_quiz_answer('${PRO}', 1, true, 'A', 1000, false, '${req(501)}');`, true);
    expect(denied.stderr).toMatch(/permission denied/);
  });
});
