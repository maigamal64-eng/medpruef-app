import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a13 admin safety proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261201090000 migration (permanent-Pro grant guard, duplicate grouping,
// guarded PUYP approval), its client privileges and the rollback.
// Opt-in only (test:db:a13); it never reads a connection URL or production env.
const databaseEnabled = process.env.A13_DATABASE_TESTS === "1";
const PORT = "55437";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A13_PG_BIN) return resolve(process.env.A13_PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8", timeout: 10_000 });
  if (config.status === 0 && config.stdout.trim()) return config.stdout.trim();
  throw new Error("PostgreSQL 16 binaries required for test:db:a13. Set A13_PG_BIN or add them to PATH.");
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261201090000_a13_admin_safety.sql");
const fixture = read("scripts/sql/track-a/a13-admin-safety/fixture.sql");
const rollback = read("scripts/sql/track-a/a13-admin-safety/down.sql");

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const SUPPORT = "00000000-0000-4000-8000-0000000000a2";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const SUB = "00000000-0000-4000-8000-0000000000c1";
const ATTEMPT = "00000000-0000-4000-8000-0000000000d1";

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
const approve = (expires: string, actor = OWNER, via = "single") =>
  `SELECT public.admin_puyp_approve('${actor}', '${ATTEMPT}', ${expires}, '${via}', 2, '{}'::jsonb);`;

describe.skipIf(!databaseEnabled)("a13 admin safety on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a13-pg16-"));
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
    sql(`TRUNCATE public.admin_audit_log, public.subscription_extensions, public.exam_attempts, public.subscriptions,
        public.admin_user_roles, public.questions, public.users CASCADE;
      INSERT INTO public.users (id, email, role, tier, tier_expires_at) VALUES
        ('${OWNER}', 'owner@example.invalid', 'admin', 'admin', NULL),
        ('${SUPPORT}', 'support@example.invalid', 'admin', 'free', NULL),
        ('${LEARNER}', 'learner@example.invalid', 'user', 'pro', now() + interval '10 days'),
        ('${OTHER}', 'other@example.invalid', 'user', 'free', NULL);
      INSERT INTO public.admin_user_roles (user_id, role_id) VALUES
        ('${OWNER}', 'aaaaaaaa-0000-4000-8000-000000000001'),
        ('${SUPPORT}', 'aaaaaaaa-0000-4000-8000-000000000002');
      INSERT INTO public.subscriptions (id, user_id, status, expires_at) VALUES ('${SUB}', '${LEARNER}', 'active', now() + interval '10 days');
      INSERT INTO public.exam_attempts (id, user_id, subscription_id, result) VALUES ('${ATTEMPT}', '${LEARNER}', '${SUB}', 'fail');`);
  });

  afterAll(() => {
    if (running) {
      const stopped = binary("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "stop"]);
      running = false;
      if (stopped.status !== 0) throw new Error(`Local PostgreSQL stop failed: ${stopped.stderr}`);
    }
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("keeps every new function away from anon and authenticated", () => {
    for (const fn of [
      "public.admin_grant_entitlement(uuid, uuid, integer, text, jsonb)",
      "public.find_duplicate_questions(text, integer)",
      "public.admin_puyp_approve(uuid, uuid, timestamptz, text, integer, jsonb)",
    ]) {
      expect(rows(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE')::text || has_function_privilege('authenticated', '${fn}', 'EXECUTE')::text || has_function_privilege('service_role', '${fn}', 'EXECUTE')::text;`)).toBe("falsefalsetrue");
    }
  });

  it("refuses a dated grant on permanent Pro and still grants dated access otherwise (ADM-06)", () => {
    sql(`UPDATE public.users SET tier = 'pro', tier_expires_at = NULL WHERE id = '${LEARNER}';`);
    expect(fails(`SELECT public.admin_grant_entitlement('${OWNER}', '${LEARNER}', 30, 'Support goodwill', '{}');`)).toMatch(/permanent Pro/);
    expect(rows(`SELECT tier || '|' || coalesce(tier_expires_at::text, 'null') FROM public.users WHERE id = '${LEARNER}';`)).toBe("pro|null");
    expect(rows(`SELECT public.admin_grant_entitlement('${OWNER}', '${OTHER}', 30, 'Support goodwill', '{}') > now() + interval '29 days';`)).toBe("t");
    expect(rows(`SELECT count(*) FROM public.admin_audit_log WHERE action = 'grant_free_access';`)).toBe("1");
    expect(fails(`SELECT public.admin_grant_entitlement('${SUPPORT}', '${OTHER}', 30, 'Support goodwill', '{}');`)).toMatch(/permission/);
  });

  it("groups duplicates across every active row, not a 1000-row sample (ADM-21)", () => {
    const prefix = "Welche Aussage zur Therapie der Herzinsuffizienz trifft zu";
    sql(`INSERT INTO public.questions (id, question, topic, exam_type, is_active)
      SELECT g, CASE WHEN g % 500 = 0 THEN '  ${prefix} ' ELSE 'Unique stem number ' || g || ' with enough characters' END,
        'Innere', CASE WHEN g > 1500 THEN 'kmp_innsbruck' ELSE 'kenntnispruefung' END, true
      FROM generate_series(1, 2500) g;
      INSERT INTO public.questions (id, question, exam_type, is_active) VALUES (9001, 'short dup', 'pharma', true), (9002, 'short dup', 'pharma', true),
        (9003, '${prefix.toUpperCase()}', 'kenntnispruefung', false);`);
    const all = JSON.parse(rows("SELECT public.find_duplicate_questions(NULL, 50);"));
    expect(all.totalGroups).toBe(1);
    expect(all.totalExtraCopies).toBe(4);
    expect(all.groups[0].questions.map((q: { id: number }) => q.id)).toEqual([500, 1000, 1500, 2000, 2500]);
    const vienna = JSON.parse(rows("SELECT public.find_duplicate_questions('kenntnispruefung', 50);"));
    expect(vienna.totalExtraCopies).toBe(2);
    expect(vienna.examType).toBe("kenntnispruefung");
  });

  it("never shortens access and records everything in one step (ADM-19)", () => {
    const result = JSON.parse(rows(approve("now() + interval '3 days'")));
    expect(result.extensions_used).toBe(1);
    expect(result.user_access).toBe("extended");
    expect(rows(`SELECT (expires_at > now() + interval '9 days')::text || '|' || puyp_extensions_used FROM public.subscriptions WHERE id = '${SUB}';`)).toBe("true|1");
    expect(rows(`SELECT (tier_expires_at > now() + interval '9 days')::text FROM public.users WHERE id = '${LEARNER}';`)).toBe("true");
    expect(rows(`SELECT count(*) FROM public.subscription_extensions WHERE attempt_id = '${ATTEMPT}';`)).toBe("1");
    expect(rows(`SELECT (verified_by = '${OWNER}')::text FROM public.exam_attempts WHERE id = '${ATTEMPT}';`)).toBe("true");
    expect(rows(`SELECT payload->>'via' FROM public.admin_audit_log WHERE action = 'approve_puyp';`)).toBe("single");
    expect(fails(approve("now() + interval '60 days'"))).toMatch(/already been decided/);
  });

  it("keeps permanent Pro and a later learner expiry", () => {
    sql(`UPDATE public.users SET tier = 'pro', tier_expires_at = NULL WHERE id = '${LEARNER}';`);
    const kept = JSON.parse(rows(approve("now() + interval '60 days'", OWNER, "bulk")));
    expect(kept.user_access).toBe("kept_permanent");
    expect(rows(`SELECT coalesce(tier_expires_at::text, 'null') FROM public.users WHERE id = '${LEARNER}';`)).toBe("null");
  });

  it("checks permission, owner, status and the extension cap", () => {
    expect(fails(approve("now() + interval '60 days'", SUPPORT))).toMatch(/permission/);
    sql(`UPDATE public.subscriptions SET status = 'refunded' WHERE id = '${SUB}';`);
    expect(fails(approve("now() + interval '60 days'"))).toMatch(/cannot be extended/);
    sql(`UPDATE public.subscriptions SET status = 'active', user_id = '${OTHER}' WHERE id = '${SUB}';`);
    expect(fails(approve("now() + interval '60 days'"))).toMatch(/different learner/);
    sql(`UPDATE public.subscriptions SET user_id = '${LEARNER}', puyp_extensions_used = 2 WHERE id = '${SUB}';`);
    expect(fails(approve("now() + interval '60 days'"))).toMatch(/cap reached/);
    sql(`UPDATE public.subscriptions SET puyp_extensions_used = 0 WHERE id = '${SUB}';`);
    expect(fails(approve("now() - interval '1 day'"))).toMatch(/future/);
    // Every failure rolled back: nothing was written.
    expect(rows(`SELECT count(*) FROM public.subscription_extensions;`)).toBe("0");
    expect(rows(`SELECT count(*) FROM public.admin_audit_log;`)).toBe("0");
    expect(rows(`SELECT verified_at IS NULL FROM public.exam_attempts WHERE id = '${ATTEMPT}';`)).toBe("t");
  });

  it("rolls back to the previous grant body and drops the new functions", () => {
    sql(rollback);
    expect(rows("SELECT count(*) FROM pg_proc WHERE proname IN ('find_duplicate_questions', 'admin_puyp_approve');")).toBe("0");
    sql(`UPDATE public.users SET tier = 'pro', tier_expires_at = NULL WHERE id = '${LEARNER}';`);
    // Pre-a13 behaviour: the grant dates permanent Pro.
    expect(rows(`SELECT public.admin_grant_entitlement('${OWNER}', '${LEARNER}', 30, 'Rollback proof', '{}') IS NOT NULL;`)).toBe("t");
    expect(rows("SELECT has_function_privilege('anon', 'public.admin_grant_entitlement(uuid, uuid, integer, text, jsonb)', 'EXECUTE');")).toBe("f");
    sql(migration);
    expect(rows("SELECT count(*) FROM pg_proc WHERE proname IN ('find_duplicate_questions', 'admin_puyp_approve');")).toBe("2");
  });
});
