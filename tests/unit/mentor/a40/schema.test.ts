import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a40 proof on a throwaway PostgreSQL 16 cluster (test:db:a40):
//  20261210090000 replaces the per-row mentor daily cost trigger with a
//  statement-level one. Totals equal a recomputation from the ledger, a
//  200k-row insert finishes and is exact, privileges stay closed, and the
//  rollback restores the per-row trigger.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.A40_DATABASE_TESTS === "1";
const PORT = "55450";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A40_PG_BIN) return resolve(process.env.A40_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a40. Set A40_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const BASE = [
  "supabase/migrations/20260428100000_ai_call_log.sql",
  "supabase/migrations/20261014090000_ai_call_log_cache_cols.sql",
  "supabase/migrations/20261014095000_ai_quota_rpc.sql",
  "supabase/migrations/20261022100000_mentor_ledger.sql",
  "supabase/migrations/20261022120000_mentor_admin_rollup.sql",
].map(read);
const migration = read("supabase/migrations/20261210090000_a40_mentor_rollup_statement_trigger.sql");
const down = read("scripts/sql/track-a/a40-mentor-control/down.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
function binary(name: string, args: string[], input?: string, timeout = 60_000) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, timeout = 60_000) {
  const result = binary("psql", ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text, timeout);
  if (result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

// Rows whose rollup differs from a recomputation over the whole ledger (0 = exact).
const MISMATCHES = `
  SELECT count(*) FROM (
    SELECT z.tz, (l.created_at AT TIME ZONE z.tz)::date AS day, sum(coalesce(cost_micro,0)) AS m,
           sum(CASE WHEN kind='house_cost' THEN coalesce(cost_micro,0) ELSE 0 END) AS h, count(*) AS c,
           count(*) FILTER (WHERE hold_micro<0 AND cost_micro > -hold_micro) AS o
    FROM public.ai_usage_ledger l CROSS JOIN (VALUES ('UTC'),('Europe/Vienna')) z(tz)
    WHERE kind IN ('settle','house_cost') GROUP BY 1,2
  ) e FULL JOIN public.ai_mentor_daily_cost d ON d.timezone=e.tz AND d.day=e.day
  WHERE d.timezone IS NULL OR e.tz IS NULL OR (d.mentor_micro,d.house_micro,d.calls,d.overruns) IS DISTINCT FROM (e.m,e.h,e.c,e.o);`;

const triggerLevel = () => sql(`SELECT CASE WHEN tgtype & 1 = 1 THEN 'row' ELSE 'statement' END FROM pg_trigger WHERE tgname='mentor_daily_cost_insert' AND tgrelid='public.ai_usage_ledger'::regclass;`);

function mixedInserts(tag: string) {
  sql(`
    INSERT INTO public.ai_usage_ledger(kind,source,source_id,cost_micro,hold_micro,created_at) VALUES
      ('settle','a40','${tag}:1',100,-50,'2026-10-10T21:59:59Z'),
      ('settle','a40','${tag}:2',200,-500,'2026-10-10T22:00:00Z'),
      ('house_cost','a40','${tag}:3',30,0,'2026-10-10T23:30:00Z'),
      ('house_cost','a40','${tag}:4',NULL,0,'2026-10-11T08:00:00Z'),
      ('reserve','a40','${tag}:5',NULL,-900,'2026-10-11T08:00:00Z'),
      ('grant','a40','${tag}:6',NULL,0,'2026-10-11T08:00:00Z');
    INSERT INTO public.ai_usage_ledger(kind,source,source_id,cost_micro,hold_micro,created_at) VALUES ('settle','a40','${tag}:7',7,-1,'2026-10-31T23:30:00Z');
    INSERT INTO public.ai_usage_ledger(kind,source,source_id,cost_micro,hold_micro,created_at) VALUES ('settle','a40','${tag}:8',5,-10,'2026-10-11T08:00:00Z');`);
}

describe.skipIf(!databaseEnabled)("a40 statement-level mentor cost rollup on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a40-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
      CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, role text DEFAULT 'user', tier text DEFAULT 'free', tier_expires_at timestamptz);
      CREATE TABLE public.payment_events (id bigserial PRIMARY KEY, event text, provider text DEFAULT 'whop', user_id uuid, tier text, plan_id text, payment_id text, amount_cents int, currency text, reason text, signature_valid boolean, matched boolean, metadata jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE public.flags (key text PRIMARY KEY, enabled boolean, env text, rollout_pct int);`);
    for (const m of BASE) sql(m);
    // Rows written under the R4 per-row trigger before the swap.
    mixedInserts("before");
    sql(migration);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("installs a statement-level trigger, removes the row function and keeps the function closed to browser roles", () => {
    expect(triggerLevel()).toBe("statement");
    expect(sql(`SELECT to_regprocedure('public.mentor_record_daily_cost()') IS NULL;`)).toBe("t");
    expect(sql(`SELECT has_function_privilege('anon','public.mentor_record_daily_cost_batch()','execute') OR has_function_privilege('authenticated','public.mentor_record_daily_cost_batch()','execute');`)).toBe("f");
    expect(sql(`SELECT has_table_privilege('authenticated','public.ai_mentor_daily_cost','select');`)).toBe("f");
  });

  it("keeps the per-row totals: rows before and after the swap equal a recomputation from the ledger", () => {
    mixedInserts("after");
    expect(sql(MISMATCHES)).toBe("0");
    // Vienna midnight: 22:00Z on 10 Oct is 11 Oct in Vienna (CEST), 21:59:59Z is still 10 Oct.
    expect(sql(`SELECT calls||':'||overruns FROM public.ai_mentor_daily_cost WHERE timezone='Europe/Vienna' AND day='2026-10-10';`)).toBe("2:2");
    // The non-cost kinds (reserve, grant) are not calls.
    expect(sql(`SELECT calls FROM public.ai_mentor_daily_cost WHERE timezone='UTC' AND day='2026-10-11';`)).toBe("4");
  });

  it("rolls up a 200k-row single statement quickly and exactly (the R4 fixture that timed out per row)", () => {
    const before = Number(sql(`SELECT coalesce(sum(mentor_micro),0) FROM public.ai_mentor_daily_cost WHERE timezone='UTC' AND day BETWEEN '2026-10-01' AND '2026-10-31';`));
    const started = Date.now();
    sql(`SET statement_timeout='45s';
      INSERT INTO public.ai_usage_ledger(kind,source,source_id,cost_micro,hold_micro,created_at)
      SELECT 'settle','a40_bulk','bulk:'||i,1,-2,'2026-10-10T12:00:00Z' FROM generate_series(1,200005) i;
      INSERT INTO public.ai_usage_ledger(kind,source,source_id,cost_micro,created_at) VALUES('house_cost','a40_bulk','bulk:edge',7,'2026-10-10T22:30:00Z');`, 90_000);
    expect(Date.now() - started).toBeLessThan(45_000);
    const after = Number(sql(`SELECT sum(mentor_micro) FROM public.ai_mentor_daily_cost WHERE timezone='UTC' AND day BETWEEN '2026-10-01' AND '2026-10-31';`));
    expect(after - before).toBe(200012);
    const snap = JSON.parse(sql(`SELECT public.mentor_admin_snapshot('2026-10','Europe/Vienna','2026-10-31T12:00:00Z')::text;`));
    expect(Number(snap.mentor_micro)).toBe(after);
    expect(sql(MISMATCHES)).toBe("0");
  }, 120_000);

  it("the rollback restores the per-row trigger and counting continues; re-applying the changeset works", () => {
    sql(down);
    expect(triggerLevel()).toBe("row");
    expect(sql(`SELECT to_regprocedure('public.mentor_record_daily_cost_batch()') IS NULL;`)).toBe("t");
    mixedInserts("rolled-back");
    expect(sql(MISMATCHES)).toBe("0");
    sql(migration);
    expect(triggerLevel()).toBe("statement");
    mixedInserts("reapplied");
    expect(sql(MISMATCHES)).toBe("0");
  });
});
