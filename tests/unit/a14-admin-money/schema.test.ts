import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a14 admin money proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261202090000 changeset (payment_resolutions + the shared paying rule in
// ops_growth_summary), its client privileges, idempotency and the rollback.
// Opt-in only (test:db:a14); it never reads a connection URL or production env.
const databaseEnabled = process.env.A14_DATABASE_TESTS === "1";
const PORT = "55438";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A14_PG_BIN) return resolve(process.env.A14_PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8", timeout: 10_000 });
  if (config.status === 0 && config.stdout.trim()) return config.stdout.trim();
  throw new Error("PostgreSQL 16 binaries required for test:db:a14. Set A14_PG_BIN or add them to PATH.");
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261202090000_a14_admin_money.sql");
const fixture = read("scripts/sql/track-a/a14-admin-money/fixture.sql");
const rollback = read("scripts/sql/track-a/a14-admin-money/down.sql");

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const PAYER = "00000000-0000-4000-8000-0000000000b1";
const TRIAL = "00000000-0000-4000-8000-0000000000b2";
const HISTORY = "00000000-0000-4000-8000-0000000000b3";
const TESTER = "00000000-0000-4000-8000-0000000000b4";
const STAFF = "00000000-0000-4000-8000-0000000000b5";

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
const fails = (text: string) => {
  const result = sql(text, true);
  expect(result.status).not.toBe(0);
  return result.stderr;
};
const growth = () => JSON.parse(rows("SET ROLE medpruf_ops_mcp; SELECT public.ops_growth_summary('h', 'production', 'a', 30)::text;")) as {
  all_time: Record<string, number>;
  trials?: { in_trial: number };
};

describe.skipIf(!databaseEnabled)("a14 admin money on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a14-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    // No TCP listener: the port only names this cluster's private socket.
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    sql(fixture);
    sql(migration);
  }, 60_000);

  beforeEach(() => {
    sql(`TRUNCATE public.payment_resolutions, public.subscriptions, public.answer_history, public.user_activity_log, public.ops_audit, public.users CASCADE;
      INSERT INTO public.users (id, email, role, tier) VALUES
        ('${OWNER}', 'user-5d9d6ceb@example.com', 'admin', 'admin'),
        ('${PAYER}', 'user-19bf8b66@example.com', 'user', 'pro'),
        ('${TRIAL}', NULL, 'user', 'pro'),
        ('${HISTORY}', 'user-b98f3a8b@example.com', 'user', 'pro'),
        ('${TESTER}', 'user-5cab158a@example.com', 'user', 'pro'),
        ('${STAFF}', 'user-87112bdd@example.com', 'user', 'pro');
      INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, amount_cents, granted_payment_ids, expires_at) VALUES
        ('${PAYER}', 'first_month_19', 'active', 'whop', 1900, NULL, now() + interval '10 days'),
        ('${PAYER}', 'first_month_19', 'active', 'whop', 1772, NULL, now() + interval '40 days'),
        ('${TRIAL}', 'notes_pro_trial', 'active', 'whop', 0, '[{"payment_id":"pay_t","amount_cents":0}]', now() + interval '5 days'),
        ('${HISTORY}', 'notes_pro_trial', 'active', 'whop', 0, '[{"payment_id":"pay_t2","amount_cents":0},{"payment_id":"pay_r","amount_cents":1900}]', now() + interval '20 days'),
        ('${TESTER}', 'first_month_19', 'active', 'whop', 1900, NULL, now() + interval '10 days'),
        ('${STAFF}', 'first_month_19', 'active', 'whop', 1900, NULL, now() + interval '10 days'),
        ('${PAYER}', 'first_month_19', 'active', 'manual', 1900, NULL, now() - interval '1 day');`);
  });

  afterAll(() => {
    if (running) {
      const stopped = binary("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
      running = false;
      if (stopped.status !== 0) throw new Error(`Local PostgreSQL stop failed: ${stopped.stderr}`);
    }
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("keeps payment_resolutions away from anon and authenticated", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(rows(`SELECT has_table_privilege('${role}', 'public.payment_resolutions', 'SELECT');`)).toBe("f");
      expect(rows(`SELECT has_table_privilege('${role}', 'public.payment_resolutions', 'INSERT');`)).toBe("f");
    }
    expect(rows("SELECT has_table_privilege('service_role', 'public.payment_resolutions', 'INSERT');")).toBe("t");
    expect(rows("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_resolutions'::regclass;")).toBe("t");
    expect(fails("SET ROLE anon; SELECT * FROM public.payment_resolutions;")).toMatch(/permission denied/);
  });

  it("allows one resolution per payment and validates kind, reason and dismissals", () => {
    sql(`INSERT INTO public.payment_resolutions (payment_id, kind, reason, actor_id) VALUES ('pay_usd50', 'test', 'Synthetic Whop test delivery', '${OWNER}');`);
    expect(fails(`INSERT INTO public.payment_resolutions (payment_id, kind, reason, actor_id) VALUES ('pay_usd50', 'not_ours', 'Second admin click', '${OWNER}');`)).toMatch(/duplicate key/);
    expect(fails(`INSERT INTO public.payment_resolutions (payment_id, kind, reason) VALUES ('pay_x', 'refund', 'Not a kind');`)).toMatch(/check constraint/);
    expect(fails(`INSERT INTO public.payment_resolutions (payment_id, kind, reason) VALUES ('pay_y', 'test', 'tiny'::text || '');`)).toMatch(/check constraint/);
    expect(fails(`INSERT INTO public.payment_resolutions (payment_id, kind, reason, user_id) VALUES ('pay_z', 'test', 'Dismissal with learner', '${PAYER}');`)).toMatch(/dismiss_no_user/);
    expect(fails(`INSERT INTO public.payment_resolutions (payment_id, kind, reason) VALUES ('bad id;--', 'test', 'Malformed id here');`)).toMatch(/check constraint/);
    sql(`INSERT INTO public.payment_resolutions (payment_id, kind, reason, user_id, actor_id) VALUES ('pay_link', 'link', 'Concierge link, matched by email', '${PAYER}', '${OWNER}');`);
    // Deleting the learner keeps the audit row and nulls the link.
    sql(`DELETE FROM public.users WHERE id = '${PAYER}';`);
    expect(rows("SELECT kind, user_id IS NULL FROM public.payment_resolutions WHERE payment_id = 'pay_link';")).toBe("link|t");
  });

  it("counts paying learners with the shared rule and reports trials apart", () => {
    const g = growth();
    // PAYER (two stacked paid rows) and HISTORY (converted trial: positive entry
    // in payment history). TRIAL has no charge; TESTER and STAFF are excluded.
    expect(g.all_time.paying).toBe(2);
    expect(g.trials?.in_trial).toBe(1);
    expect(g.all_time.signups).toBe(3);
    expect(Object.keys(g.all_time).sort()).toEqual(["activated", "engaged", "paying", "signups"]);
    expect(rows("SELECT count(*) FROM public.ops_audit WHERE event = 'growth.summary';")).toBe("1");
  });

  it("keeps the ops read ACL unchanged", () => {
    const fn = "public.ops_growth_summary(text,text,text,integer)";
    expect(rows(`SELECT has_function_privilege('medpruf_ops_mcp', '${fn}', 'EXECUTE');`)).toBe("t");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(rows(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE');`)).toBe("f");
    }
    expect(fails("SET ROLE medpruf_ops_mcp; SELECT public.ops_growth_summary('h', 'production', 'a', 0);")).toMatch(/Invalid query bounds/);
  });

  it("is idempotent and rolls back to the previous paying rule", () => {
    sql(migration);
    expect(growth().all_time.paying).toBe(2);
    sql(rollback);
    expect(rows("SELECT to_regclass('public.payment_resolutions') IS NULL;")).toBe("t");
    const before = growth();
    // Pre-a14: every active real-rail row counts, trials included, and only the
    // internal domains are excluded (the qa.run tester counts again).
    expect(before.all_time.paying).toBe(4);
    expect(before.trials).toBeUndefined();
    expect(rows("SELECT has_function_privilege('medpruf_ops_mcp', 'public.ops_growth_summary(text,text,text,integer)', 'EXECUTE');")).toBe("t");
    sql(migration);
    expect(growth().all_time.paying).toBe(2);
  });
});
