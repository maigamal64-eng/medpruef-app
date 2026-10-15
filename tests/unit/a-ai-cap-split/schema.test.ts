import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-ai-cap-split (plan.json J3) on a throwaway PostgreSQL 16 cluster with the
// production order: mentor ledger live, then the before-image, the a38
// apply, the read-back, the rollback and a re-apply. Opt-in only
// (npm run test:db:a-ai-cap-split); never reads a connection URL or production env.
const databaseEnabled = process.env.A_AI_CAP_SPLIT_DATABASE_TESTS === "1";
const PORT = "55451";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A38_PG_BIN) return resolve(process.env.A38_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set A38_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const BASE = [
  "supabase/migrations/20260428100000_ai_call_log.sql",
  "supabase/migrations/20261014090000_ai_call_log_cache_cols.sql",
  "supabase/migrations/20261014095000_ai_quota_rpc.sql",
  "supabase/migrations/20261022100000_mentor_ledger.sql",
].map(read);
const migration = read("supabase/migrations/20261208090000_a38_mentor_spend_split.sql");
const down = read("scripts/sql/track-a/a38-mentor-ledger/down.sql");
const beforeImage = read("scripts/sql/track-a/a-ai-cap-split/before-image.sql");
const verify = read("scripts/sql/track-a/a-ai-cap-split/verify.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string) {
  const result = binary("psql", ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-q", "-P", "footer=off"], text);
  if (result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}
/** One-row result of a read-only runbook file as { column: value }. */
function row(text: string): Record<string, string> {
  // psql -1 opens the transaction, so READ ONLY proves the runbook file writes nothing.
  const [header, values] = sql(`SET TRANSACTION READ ONLY;\n${text}`).split("\n");
  const keys = header.split("|");
  const cells = values.split("|");
  return Object.fromEntries(keys.map((k, i) => [k, cells[i]]));
}

const U = "00000000-0000-4000-8000-0000000000e1";

describe.skipIf(!databaseEnabled)("J3 runbook on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "j3-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
      -- Supabase default: new functions are executable by anon and authenticated unless revoked.
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
      CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, role text DEFAULT 'user', tier text DEFAULT 'free', tier_expires_at timestamptz);
      CREATE TABLE public.payment_events (id bigserial PRIMARY KEY, event text, provider text DEFAULT 'whop', user_id uuid, tier text, plan_id text, payment_id text, amount_cents int, currency text, reason text, signature_valid boolean, matched boolean, metadata jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE public.flags (key text PRIMARY KEY, enabled boolean, env text, rollout_pct int);
      INSERT INTO public.users (id, email) VALUES ('${U}', 'j3@example.invalid');`);
    for (const m of BASE) sql(m);
    // Production gets this from Supabase default privileges; the app already reads ai_spend_month as service_role.
    sql("GRANT SELECT ON public.ai_call_log TO service_role;");
    // This month: one translate call (legacy), one mentor-route log row (not legacy), one mentor settle.
    sql(`INSERT INTO public.ai_call_log (user_id, provider, model, cost_usd, route, created_at) VALUES
      ('${U}', 'anthropic', 'claude-haiku-4-5', 0.2219, 'translate', now()),
      ('${U}', 'anthropic', 'claude-haiku-5-5', 0.5, 'mentor', now());
      SELECT public.mentor_grant_credits('${U}','gift_admin','admin_gift','j3-${U}',1000000::bigint);
      SELECT public.mentor_reserve('${U}','00000000-0000-4000-8000-0000000000f1',0::smallint,40000::bigint);
      SELECT public.mentor_settle('00000000-0000-4000-8000-0000000000f1',0::smallint,4377::bigint,'{"input_tokens":1}'::jsonb,true);
      -- About EUR 300 of net revenue in 30 days: 6 percent is USD 18, so the floor rules.
      INSERT INTO public.payment_events (event, payment_id, amount_cents, signature_valid, metadata)
        SELECT 'webhook_received', 'pay_j3_' || g, 2715, true, '{"whop_event":"payment.succeeded"}'::jsonb FROM generate_series(1, 11) g;`);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("before-image: split missing, ledger live, cap 50 today and 80 at the target", () => {
    const b = row(beforeImage);
    expect(b.split_fn).toBe("");
    expect(b.split_fn_def_if_present).toBe("");
    expect(b.ledger).toBe("ai_usage_ledger");
    expect(b.month_fn).not.toBe("");
    expect(b.cap_fn).not.toBe("");
    expect(Number(b.month_spend_micro)).toBe(221_900 + 4_377);
    expect(b.cap_sql_default_micro).toBe("50000000");
    expect(b.cap_current_micro).toBe("50000000");
    expect(b.cap_target_micro).toBe("80000000");
    expect(b).toMatchObject({ legacy_pre_micro: "221900", mentor_pre_micro: "4377", mentor_would_rest: "f", legacy_would_rest: "f" });
  });

  it("apply then read-back: installed, service_role only, sums match, 80 split 48 / 32", () => {
    sql(migration);
    const v = row(verify);
    expect(v).toMatchObject({
      installed: "t", anon_exec: "f", authenticated_exec: "f", service_exec: "t", sum_matches: "t",
      mentor_spent_micro: "4377", legacy_spent_micro: "221900",
      cap_micro: "80000000", mentor_cap_micro: "48000000", legacy_cap_micro: "32000000",
      mentor_below_cap: "t", legacy_below_cap: "t",
    });
    // The app calls it as service_role (SECURITY INVOKER): same split, no permission error.
    expect(sql(`SET ROLE service_role; SELECT public.ai_spend_month_split(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'))::text;`).split("\n")[1])
      .toBe('{"legacy_micro": 221900, "mentor_micro": 4377}');
    expect(() => sql(`SET ROLE anon; SELECT public.ai_spend_month_split('2026-10');`)).toThrow(/permission denied/);
  });

  it("rollback drops only the split read; re-apply restores it", () => {
    sql(down);
    expect(row(beforeImage).split_fn).toBe("");
    expect(sql("SELECT public.ai_spend_cap(80000000, 6);").split("\n")[1]).toBe("80000000");
    sql(migration);
    expect(row(verify).installed).toBe("t");
  });

  it("before-image stops the apply when one lane is already over its share, though the total is under 80", () => {
    sql(down);
    // Legacy USD 33 this month: under the old shared 50 and the new total 80, over the legacy share 32.
    sql(`INSERT INTO public.ai_call_log (user_id, provider, model, cost_usd, route, created_at) VALUES ('${U}', 'anthropic', 'claude-haiku-4-5', 33, 'translate', now());`);
    const b = row(beforeImage);
    expect(Number(b.month_spend_micro)).toBeLessThan(80_000_000);
    expect(b).toMatchObject({ legacy_would_rest: "t", mentor_would_rest: "f" });
    sql(migration);
    expect(row(verify)).toMatchObject({ legacy_below_cap: "f", mentor_below_cap: "t" });
  });
});
