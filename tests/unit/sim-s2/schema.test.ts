import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// sim_sessions proof on a throwaway PostgreSQL 16 cluster (npm run test:db:sim-sessions):
// the unapplied 20270118090000 changeset, its constraints, privileges and down.sql.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.SIM_SESSIONS_DATABASE_TESTS === "1";
const PORT = "55481";
let pgBin = "";
function discoverPgBin() {
  if (process.env.SIM_SESSIONS_PG_BIN) return resolve(process.env.SIM_SESSIONS_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:sim-sessions. Set SIM_SESSIONS_PG_BIN.");
}
const read = (p: string) => readFileSync(resolve(p), "utf8");
const migration = read("supabase/migrations/20270118090000_a_sim_sessions.sql");
const fixture = read("scripts/sql/track-a/a-sim-sessions/fixture.sql");
const down = read("scripts/sql/track-a/a-sim-sessions/down.sql");

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
const fails = (text: string, pattern: RegExp) => {
  const result = sql(text, true);
  expect(result.status, result.stdout).not.toBe(0);
  expect(result.stderr).toMatch(pattern);
};

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const S1 = "3f2a8c1e-9b7d-4c2a-8e1f-0a1b2c3d4e5f";
const S2 = "4a3b9d2f-8c6e-4d3b-9f2a-1b2c3d4e5f60";
const insert = (id: string, user: string, extra: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    id: `'${id}'`, user_id: `'${user}'`, profile_key: `'de_kenntnispruefung'`, case_id: `'fall-eins'`, mode: `'full_exam'`, state: `'{"v":1}'::jsonb`, ...extra,
  };
  return `INSERT INTO public.sim_sessions (${Object.keys(base).join(", ")}) VALUES (${Object.values(base).join(", ")});`;
};

describe.skipIf(!databaseEnabled)("sim_sessions on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "sim-sessions-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(`INSERT INTO public.users (id, email) VALUES ('${U1}', 'a@x.test'), ('${U2}', 'b@x.test');`);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("applies and re-applies cleanly; RLS is on with no policies", () => {
    sql(migration);
    sql(migration);
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sim_sessions'::regclass;`)).toBe("t");
    expect(rows(`SELECT count(*) FROM pg_policies WHERE tablename = 'sim_sessions';`)).toBe("0");
    expect(rows(`SELECT count(*) FROM pg_indexes WHERE tablename = 'sim_sessions' AND indexname IN ('sim_sessions_user_status_idx','sim_sessions_user_created_idx');`)).toBe("2");
  });

  it("anon and authenticated are denied, service_role reads and writes", () => {
    expect(rows(`SELECT has_table_privilege('anon','public.sim_sessions','SELECT')::text || has_table_privilege('authenticated','public.sim_sessions','SELECT')::text || has_table_privilege('anon','public.sim_sessions','INSERT')::text || has_table_privilege('authenticated','public.sim_sessions','UPDATE')::text || has_table_privilege('authenticated','public.sim_sessions','DELETE')::text;`)).toBe("falsefalsefalsefalsefalse");
    fails(`SET ROLE anon; SELECT 1 FROM public.sim_sessions;`, /permission denied/);
    fails(`SET ROLE authenticated; SELECT 1 FROM public.sim_sessions;`, /permission denied/);
    fails(`SET ROLE authenticated; ${insert(S2, U1)}`, /permission denied/);
    sql(`SET ROLE service_role; ${insert(S1, U1)} UPDATE public.sim_sessions SET state_version = 2 WHERE id = '${S1}';`);
    expect(rows(`SET ROLE service_role; SELECT state_version FROM public.sim_sessions WHERE id = '${S1}';`)).toMatch(/2$/);
  });

  it("constraints reject a bad mode, status, state, version, cost, profile key and a closed row without its stamp", () => {
    fails(insert(S2, U1, { mode: `'solo'` }), /sim_sessions_mode/);
    fails(insert(S2, U1, { status: `'paused'` }), /sim_sessions_status/);
    fails(insert(S2, U1, { state: `'[]'::jsonb` }), /sim_sessions_state_shape/);
    fails(insert(S2, U1, { state_version: "0" }), /sim_sessions_version_positive/);
    fails(insert(S2, U1, { cost_micro_usd: "-1" }), /sim_sessions_cost_nonneg/);
    fails(insert(S2, U1, { profile_key: `'Bad Key'` }), /sim_sessions_profile_key_shape/);
    fails(insert(S2, U1, { status: `'finished'` }), /sim_sessions_closed_stamp/);
    fails(insert(S2, U1, { finished_at: "now()" }), /sim_sessions_closed_stamp/);
    sql(insert(S2, U1, { status: `'abandoned'`, abandoned_at: "now()" }));
    sql(`DELETE FROM public.sim_sessions WHERE id = '${S2}';`);
  });

  it("the primary key refuses a repeated id and deleting the user removes their sessions", () => {
    fails(insert(S1, U2), /duplicate key|sim_sessions_pkey/);
    fails(insert(S2, "00000000-0000-4000-8000-0000000000ff"), /foreign key/);
    sql(insert(S2, U2));
    sql(`DELETE FROM public.users WHERE id = '${U2}';`);
    expect(rows(`SELECT count(*) FROM public.sim_sessions WHERE user_id = '${U2}';`)).toBe("0");
  });

  it("down.sql removes the table and is repeatable; the migration re-applies afterwards", () => {
    sql(down);
    expect(rows(`SELECT to_regclass('public.sim_sessions') IS NULL;`)).toBe("t");
    sql(down);
    sql(migration);
    expect(rows(`SELECT count(*) FROM public.sim_sessions;`)).toBe("0");
  });
});
