import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkLaneSpend, type RpcClient } from "../../../../src/lib/ai/limits";

// a38 proof on a throwaway PostgreSQL 16 cluster (test:db:a38):
//  20261208090000 ai_spend_month_split returns exactly ai_spend_month split
//  into its two lanes, is idempotent, service_role only, and the rollback
//  drops it; the app's lane check then falls back to the shared total.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.A38_DATABASE_TESTS === "1";
const PORT = "55449";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A38_PG_BIN) return resolve(process.env.A38_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a38. Set A38_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const MIGRATIONS = [
  "supabase/migrations/20260428100000_ai_call_log.sql",
  "supabase/migrations/20261014090000_ai_call_log_cache_cols.sql",
  "supabase/migrations/20261014095000_ai_quota_rpc.sql",
  "supabase/migrations/20261022100000_mentor_ledger.sql",
].map(read);
const migration = read("supabase/migrations/20261208090000_a38_mentor_spend_split.sql");
const down = read("scripts/sql/track-a/a38-mentor-ledger/down.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();

/** PostgREST-shaped client over psql as service_role (one connection per call). */
const pg: RpcClient = {
  async rpc(fn, args = {}) {
    const types: Record<string, string> = { p_month: "text", p_floor_micro: "bigint", p_net_pct: "numeric" };
    const named = Object.entries(args).map(([k, v]) => `${k} => '${String(v).replace(/'/g, "''")}'::${types[k] ?? "text"}`).join(", ");
    const r = sql(`SET ROLE service_role; SELECT to_jsonb(public.${fn}(${named}))::text;`, true);
    if (r.status !== 0) return { data: null, error: { message: r.stderr.trim().slice(0, 300) } };
    return { data: JSON.parse(r.stdout.trim()), error: null };
  },
};

const U = "00000000-0000-4000-8000-0000000000c1";

describe.skipIf(!databaseEnabled)("a38 spend split on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a38-pg16-"));
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
      CREATE TABLE public.flags (key text PRIMARY KEY, enabled boolean, env text, rollout_pct int);
      INSERT INTO public.users (id, email) VALUES ('${U}', 'a38@example.invalid');`);
    for (const m of MIGRATIONS) sql(m);
    sql("GRANT SELECT, INSERT ON public.ai_call_log TO service_role; GRANT SELECT ON public.payment_events TO service_role;");
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("returns ai_spend_month split into legacy and mentor lanes; idempotent; service_role only", () => {
    sql(migration);
    sql(migration);
    // Legacy rows: one in month, one mentor-route row (excluded), one OpenAI row (excluded), one last month (excluded).
    sql(`INSERT INTO public.ai_call_log (user_id, provider, model, cost_usd, route, created_at) VALUES
      ('${U}', 'anthropic', 'claude-haiku-4-5', 0.012345, 'ai_chat', '2026-10-05T10:00:00Z'),
      ('${U}', 'anthropic', 'claude-haiku-4-5', 0.5, 'mentor', '2026-10-05T10:00:00Z'),
      ('${U}', 'openai', 'gpt-4o-mini', 0.7, 'ai_chat', '2026-10-05T10:00:00Z'),
      ('${U}', 'anthropic', 'claude-haiku-4-5', 0.9, 'translate', '2026-09-30T23:59:59Z');`);
    // Mentor consumption: a settle and a house_cost; a grant never counts.
    expect(rows(`SELECT (public.mentor_grant_credits('${U}','gift_admin','admin_gift','a38-${U}',1000000::bigint))->>'ok';`)).toBe("true");
    const req = "00000000-0000-4000-8000-0000000000d1";
    sql(`SELECT public.mentor_reserve('${U}','${req}',0::smallint,40000::bigint);
      SELECT public.mentor_settle('${req}',0::smallint,30000::bigint,'{"input_tokens":1}'::jsonb,true);
      SELECT public.mentor_reserve('${U}','${req}',1::smallint,40000::bigint);
      SELECT public.mentor_settle('${req}',1::smallint,20000::bigint,'{"input_tokens":1}'::jsonb,false);`);
    const split = JSON.parse(rows("SELECT public.ai_spend_month_split('2026-10')::text;"));
    expect(split).toEqual({ legacy_micro: 12345, mentor_micro: 50000 });
    expect(Number(rows("SELECT public.ai_spend_month('2026-10');"))).toBe(split.legacy_micro + split.mentor_micro);
    for (const role of ["anon", "authenticated"]) expect(rows(`SELECT has_function_privilege('${role}', 'public.ai_spend_month_split(text)', 'EXECUTE');`)).toBe("f");
    expect(rows("SELECT has_function_privilege('service_role', 'public.ai_spend_month_split(text)', 'EXECUTE');")).toBe("t");
    expect(sql("SELECT public.ai_spend_month_split('2026-13');", true).status).not.toBe(0);
  });

  it("the app lane check reads the real split; after the rollback it falls back to the shared total", async () => {
    sql(migration);
    const month = new Date("2026-10-12T00:00:00Z");
    const opts = (floorMicro: number, mentorSharePct: number) => ({ now: month, floorMicro, netPct: 0, mentorSharePct });
    expect(await checkLaneSpend(pg, "mentor", opts(200_000, 50))).toMatchObject({ split: true, ok: true, spentMicro: 50_000, capMicro: 100_000, totalCapMicro: 200_000 });
    expect(await checkLaneSpend(pg, "legacy", opts(200_000, 50))).toMatchObject({ split: true, ok: true, spentMicro: 12_345, capMicro: 100_000 });
    // Mentor over its share rests the mentor only; legacy (12,345 of 160,000) keeps running.
    expect(await checkLaneSpend(pg, "mentor", opts(200_000, 20))).toMatchObject({ split: true, ok: false, reason: "global_cap", capMicro: 40_000 });
    expect(await checkLaneSpend(pg, "legacy", opts(200_000, 20))).toMatchObject({ split: true, ok: true, capMicro: 160_000 });
    sql(down);
    expect(rows("SELECT to_regprocedure('public.ai_spend_month_split(text)') IS NULL;")).toBe("t");
    const shared = await checkLaneSpend(pg, "mentor", opts(60_000, 50));
    expect(shared).toMatchObject({ split: false, ok: false, reason: "global_cap", spentMicro: 62_345, capMicro: 60_000 });
    sql(migration);
    expect(rows("SELECT to_regprocedure('public.ai_spend_month_split(text)') IS NOT NULL;")).toBe("t");
  });
});
