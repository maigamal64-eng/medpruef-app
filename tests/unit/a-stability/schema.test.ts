import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

// a-stability proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261230090000 covering index on questions, on a realistic copy shape
// (11k questions, ~26k answer rows, ~19k review rows). Opt-in only
// (test:db:a-stability); never reads a connection URL or production env.
const databaseEnabled = process.env.A_STABILITY_DATABASE_TESTS === "1";
const PORT = "55451";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A_STABILITY_PG_BIN) return resolve(process.env.A_STABILITY_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a-stability. Set A_STABILITY_PG_BIN.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261230090000_a_stability_questions_cover_idx.sql");
const fixture = read("scripts/sql/track-a/a-stability/fixture.sql");
const seed = read("scripts/sql/track-a/a-stability/seed.sql");
const rollback = read("scripts/sql/track-a/a-stability/down.sql");
const HEAVY = "00000000-0000-4000-8000-000000000001";
const LIGHT = "00000000-0000-4000-8000-000000000007";
const INDEX = "questions_exam_type_id_cover_idx";

// Socket paths are limited to 103 bytes, so the cluster lives under /tmp.
let cluster = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 120_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();

const BODIES: Record<string, (user: string) => string> = {
  progress: (u) => `SELECT coalesce(nullif(q.topic, ''), 'Unknown'), count(DISTINCT ah.question_id), count(DISTINCT ah.question_id) FILTER (WHERE ah.is_correct), count(DISTINCT ah.question_id) FILTER (WHERE NOT ah.is_correct)
    FROM answer_history ah JOIN questions q ON q.id = ah.question_id WHERE ah.user_id = '${u}' AND q.exam_type = 'kenntnispruefung' AND q.is_active = true GROUP BY 1`,
  attempts: (u) => `SELECT coalesce(nullif(q.topic, ''), 'Unknown'), count(*), count(*) FILTER (WHERE ah.is_correct)
    FROM answer_history ah JOIN questions q ON q.id = ah.question_id WHERE ah.user_id = '${u}' AND q.exam_type = 'kenntnispruefung' GROUP BY 1`,
  lastCorrect: (u) => `WITH newest AS (SELECT DISTINCT ON (ah.question_id) ah.question_id, ah.is_correct, coalesce(nullif(q.topic, ''), 'Unknown') AS topic
    FROM answer_history ah JOIN questions q ON q.id = ah.question_id WHERE ah.user_id = '${u}' AND q.exam_type = 'kenntnispruefung' ORDER BY ah.question_id, ah.created_at DESC, ah.id DESC)
    SELECT topic, count(*), count(*) FILTER (WHERE is_correct) FROM newest GROUP BY topic`,
  freeAnswered: (u) => `SELECT ah.question_id FROM answer_history ah JOIN questions q ON q.id = ah.question_id
    WHERE ah.user_id = '${u}' AND ah.question_id > 0 AND q.exam_type = 'kenntnispruefung' AND q.is_active = true ORDER BY ah.question_id LIMIT 1000`,
};

interface PlanNode { "Node Type"?: string; "Index Name"?: string; "Relation Name"?: string; "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number; Plans?: PlanNode[] }
function plan(body: string): PlanNode {
  // Warm run first so the comparison measures pages touched, not cold reads.
  sql(`${body};`);
  const out = rows(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${body};`);
  return (JSON.parse(out) as Array<{ Plan: PlanNode }>)[0].Plan;
}
function nodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(nodes)];
}
const buffers = (node: PlanNode) => (node["Shared Hit Blocks"] ?? 0) + (node["Shared Read Blocks"] ?? 0);
const questionScans = (node: PlanNode) => nodes(node).filter((n) => n["Relation Name"] === "questions");
function results(): string {
  return rows(`
    SET ROLE service_role;
    SELECT string_agg(x, ';' ORDER BY x) FROM (
      SELECT 'p:' || topic || ':' || answered || ':' || correct || ':' || wrong AS x FROM get_user_topic_progress('${HEAVY}', 'kenntnispruefung')
      UNION ALL SELECT 'a:' || topic || ':' || attempts || ':' || correct_attempts FROM get_user_topic_attempt_stats('${HEAVY}', 'kenntnispruefung')
      UNION ALL SELECT 'l:' || topic || ':' || answered || ':' || last_correct FROM get_user_topic_last_correct('${HEAVY}', 'kenntnispruefung')
      UNION ALL SELECT 'c:' || topic || ':' || count FROM get_topic_counts('kenntnispruefung')
      UNION ALL SELECT 'n:' || topic || ':' || count FROM get_topic_counts(NULL)
      UNION ALL SELECT 'l7:' || topic || ':' || answered || ':' || last_correct FROM get_user_topic_last_correct('${LIGHT}', 'kenntnispruefung')
    ) s;`);
}

describe.skipIf(!databaseEnabled)("a-stability covering index on isolated PostgreSQL 16", () => {
  const before: Record<string, PlanNode> = {};
  let resultsBefore = "";

  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync("/tmp/stab-pg16-");
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(seed);
    for (const [name, body] of Object.entries(BODIES)) before[name] = plan(body(HEAVY));
    resultsBefore = results();
    sql(migration);
    sql("VACUUM ANALYZE public.questions;");
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("loads the realistic copy shape", () => {
    const [questions, answers, reviews, heaviest] = rows(`SELECT (SELECT count(*) FROM questions), (SELECT count(*) FROM answer_history),
      (SELECT count(*) FROM user_question_progress), (SELECT max(c) FROM (SELECT count(*) c FROM answer_history GROUP BY user_id) x);`).split("|").map(Number);
    expect(questions).toBe(11_000);
    expect(answers).toBeGreaterThan(25_000);
    expect(answers).toBeLessThan(27_000);
    expect(reviews).toBeGreaterThan(17_000);
    expect(reviews).toBeLessThan(21_000);
    expect(heaviest).toBe(1_500);
  });

  it("before the index, each learner aggregate reads the exam's question heap", () => {
    for (const name of ["progress", "attempts", "lastCorrect"]) {
      const scans = questionScans(before[name]);
      expect(scans.some((n) => n["Node Type"] === "Index Only Scan"), name).toBe(false);
      expect(buffers(before[name]), name).toBeGreaterThan(1_000);
    }
  });

  it("after the index, the same reads are index-only and touch under a fifth of the pages", () => {
    for (const name of Object.keys(BODIES)) {
      const after = plan(BODIES[name](HEAVY));
      const scans = questionScans(after);
      expect(scans.length, name).toBeGreaterThan(0);
      expect(scans.every((n) => n["Node Type"] === "Index Only Scan" && n["Index Name"] === INDEX), name).toBe(true);
      expect(buffers(after), name).toBeLessThan(buffers(before[name]) / 5);
    }
  });

  it("changes no result of any topic function", () => {
    expect(results()).toBe(resultsBefore);
    expect(resultsBefore.length).toBeGreaterThan(100);
  });

  it("is idempotent and adds no grant, function or row change", () => {
    const functionsBefore = rows("SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace;");
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_indexes WHERE indexname = '${INDEX}';`)).toBe("1");
    expect(rows("SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace;")).toBe(functionsBefore);
    expect(rows("SELECT count(*) FROM questions;")).toBe("11000");
  });

  it("rolls back cleanly and the plans return to the heap", () => {
    sql(rollback);
    sql(rollback);
    expect(rows(`SELECT count(*) FROM pg_indexes WHERE indexname = '${INDEX}';`)).toBe("0");
    const reverted = plan(BODIES.progress(HEAVY));
    expect(questionScans(reverted).some((n) => n["Index Name"] === INDEX)).toBe(false);
    expect(results()).toBe(resultsBefore);
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_indexes WHERE indexname = '${INDEX}';`)).toBe("1");
  });
});
