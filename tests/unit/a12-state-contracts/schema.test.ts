import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a12 proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261221090000 changeset (newest-attempt "zuletzt richtig" per topic),
// its privileges, idempotency and rollback. Opt-in only (test:db:a12);
// never reads a connection URL or production env.
const databaseEnabled = process.env.A12_DATABASE_TESTS === "1";
const PORT = "55441";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A12_PG_BIN) return resolve(process.env.A12_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a12. Set A12_PG_BIN.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261221090000_a12_learning_metrics.sql");
const fixture = read("scripts/sql/track-a/a12-state-contracts/fixture.sql");
const rollback = read("scripts/sql/track-a/a12-state-contracts/down.sql");
const LEARNER = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

let cluster = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 30_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();

describe.skipIf(!databaseEnabled)("a12 learning metrics on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a12-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(migration);
    sql(`
      INSERT INTO public.questions (id, topic, exam_type) VALUES
        (1, 'HNO', 'kenntnispruefung'), (2, 'HNO', 'kenntnispruefung'), (3, '', 'kenntnispruefung'), (4, 'HNO', 'pharma');
      INSERT INTO public.answer_history (user_id, question_id, is_correct, created_at) VALUES
        ('${LEARNER}', 1, false, '2026-10-01T09:00Z'), ('${LEARNER}', 1, true, '2026-10-02T09:00Z'),
        ('${LEARNER}', 2, true, '2026-10-01T09:00Z'), ('${LEARNER}', 2, false, '2026-10-03T09:00Z'),
        ('${LEARNER}', 2, true, '2026-10-03T09:00Z'),
        ('${LEARNER}', 3, true, '2026-10-04T09:00Z'),
        ('${LEARNER}', 4, false, '2026-10-04T09:00Z'),
        ('${OTHER}', 1, true, '2026-10-05T09:00Z');
    `);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("counts distinct answered questions and the newest attempt per topic, ties by highest id", () => {
    const out = rows(`SET ROLE service_role; SELECT string_agg(topic || ':' || answered || ':' || last_correct, ',' ORDER BY topic) FROM public.get_user_topic_last_correct('${LEARNER}', 'kenntnispruefung');`);
    // q1 newest correct, q2 tie at 09:00 -> later insert (correct) wins; '' topic -> Unknown; pharma row excluded.
    expect(out).toBe("HNO:2:2,Unknown:1:1");
    expect(rows(`SET ROLE service_role; SELECT count(*) FROM public.get_user_topic_last_correct('${LEARNER}', 'pharma');`)).toBe("1");
  });
  it("is service_role only", () => {
    for (const role of ["anon", "authenticated"]) {
      const denied = sql(`SET ROLE ${role}; SELECT * FROM public.get_user_topic_last_correct('${LEARNER}', 'kenntnispruefung');`, true);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toMatch(/permission denied/);
    }
  });
  it("re-applies idempotently and rolls back cleanly", () => {
    sql(migration);
    sql(rollback);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname = 'get_user_topic_last_correct';`)).toBe("0");
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname = 'get_user_topic_last_correct';`)).toBe("1");
  });
});
