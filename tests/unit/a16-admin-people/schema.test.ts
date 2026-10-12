import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a16 admin people proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261203090000 changeset (directory v2 with learner-only last active and
// segments, segment counts, Ops decision read), its client privileges,
// idempotency and rollback. Opt-in only (test:db:a16); never reads a
// connection URL or production env.
const databaseEnabled = process.env.A16_DATABASE_TESTS === "1";
const PORT = "55439";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A16_PG_BIN) return resolve(process.env.A16_PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8", timeout: 10_000 });
  if (config.status === 0 && config.stdout.trim()) return config.stdout.trim();
  throw new Error("PostgreSQL 16 binaries required for test:db:a16. Set A16_PG_BIN or add them to PATH.");
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261203090000_a16_admin_people.sql");
const fixture = read("scripts/sql/track-a/a16-admin-people/fixture.sql");
const rollback = read("scripts/sql/track-a/a16-admin-people/down.sql");

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const READER = "00000000-0000-4000-8000-0000000000a2";
const STALE = "00000000-0000-4000-8000-0000000000b1"; // bulk-updated row, old answer
const SILENT = "00000000-0000-4000-8000-0000000000b2"; // never did anything
const PRO = "00000000-0000-4000-8000-0000000000b3"; // pro, quiet for 10 days, exam soon
const FRESH = "00000000-0000-4000-8000-0000000000b4"; // answered today, onboarded

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
const json = <T>(text: string) => JSON.parse(rows(text)) as T;
type Directory = { total: number; items: Array<{ id: string; status: string; last_active: string | null }> };
const directory = (segment: string, extra = "'last_active', 'desc'") =>
  json<Directory>(`SET ROLE service_role; SELECT public.admin_user_directory_v2(NULL, 'all', 'all', '${segment}', ${extra}, 50, 0)::text;`);

describe.skipIf(!databaseEnabled)("a16 admin people on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a16-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    sql(fixture);
    sql(migration);
    sql(`
      INSERT INTO public.users (id, email, role, tier, tier_expires_at, exam_date, onboarding_completed_at, updated_at, created_at) VALUES
        ('${OWNER}', 'user-5d9d6ceb@example.com', 'admin', 'admin', NULL, NULL, NULL, now(), now() - interval '300 days'),
        ('${READER}', 'user-6fad5ab3@example.com', 'admin', 'admin', NULL, NULL, NULL, now(), now() - interval '300 days'),
        ('${STALE}', 'user-0e03ec33@example.com', 'user', 'free', NULL, NULL, now() - interval '90 days', now(), now() - interval '120 days'),
        ('${SILENT}', 'user-e30d109a@example.com', 'user', 'free', NULL, NULL, NULL, now(), now() - interval '20 days'),
        ('${PRO}', 'user-c8ba6e8c@example.com', 'user', 'pro', now() + interval '20 days', (now() AT TIME ZONE 'Europe/Vienna')::date + 10, now() - interval '30 days', now(), now() - interval '40 days'),
        ('${FRESH}', 'user-58748b5b@example.com', 'user', 'free', NULL, (now() AT TIME ZONE 'Europe/Vienna')::date + 90, now(), now(), now() - interval '2 days');
      INSERT INTO public.answer_history (user_id, is_correct, created_at) VALUES
        ('${STALE}', true, now() - interval '60 days'), ('${PRO}', false, now() - interval '12 days'), ('${FRESH}', true, now() - interval '1 hour');
      -- System writes never count as learner activity.
      INSERT INTO public.user_events (user_id, event_type, created_at) VALUES
        ('${STALE}', 'whop_subscription_activated', now() - interval '1 day'),
        ('${STALE}', 'cron_trial_reminder_heartbeat', now() - interval '1 hour'),
        ('${SILENT}', 'puyp_extension_granted', now() - interval '2 hours'),
        ('${PRO}', 'page_view', now() - interval '11 days');
      INSERT INTO public.user_sessions (user_id, started_at) VALUES ('${PRO}', now() - interval '10 days');
      INSERT INTO public.admin_roles (id, role_key) VALUES ('10000000-0000-4000-8000-000000000001', 'owner'), ('10000000-0000-4000-8000-000000000002', 'support');
      INSERT INTO public.admin_user_roles VALUES ('${OWNER}', '10000000-0000-4000-8000-000000000001'), ('${READER}', '10000000-0000-4000-8000-000000000002');
      INSERT INTO public.admin_role_permissions VALUES ('10000000-0000-4000-8000-000000000001', 'system.read'), ('10000000-0000-4000-8000-000000000001', 'users.read'), ('10000000-0000-4000-8000-000000000002', 'users.read');
      INSERT INTO public.ops_principals (id, name) VALUES ('20000000-0000-4000-8000-000000000001', 'ops-agent');
      INSERT INTO public.ops_actions (id, principal_id, operation, payload, status) VALUES
        ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'entitlement.grant', '{"user_id":"${PRO}","days":7,"reason":"Support goodwill"}', 'succeeded'),
        ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'feedback.triage', '{"feedback_id":12,"status":"resolved","note":"x"}', 'rejected');
      INSERT INTO public.ops_audit (action_id, actor_id, event, created_at) VALUES
        ('30000000-0000-4000-8000-000000000001', NULL, 'action.prepared', now() - interval '3 hours'),
        ('30000000-0000-4000-8000-000000000001', '${OWNER}', 'action.approved', now() - interval '2 hours'),
        ('30000000-0000-4000-8000-000000000001', NULL, 'action.succeeded', now() - interval '1 hour'),
        ('30000000-0000-4000-8000-000000000002', '${OWNER}', 'action.rejected', now() - interval '30 minutes');
    `);
  }, 60_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("last active ignores updated_at and system events; no activity sorts last", () => {
    const all = directory("all");
    const byId = new Map(all.items.map((i) => [i.id, i]));
    const stale = byId.get(STALE)!;
    expect(Date.now() - Date.parse(stale.last_active!)).toBeGreaterThan(59 * 86_400_000);
    expect(stale.status).toBe("inactive");
    expect(byId.get(SILENT)!.last_active).toBeNull();
    expect(byId.get(SILENT)!.status).toBe("none");
    expect(Date.now() - Date.parse(byId.get(PRO)!.last_active!)).toBeLessThan(10.1 * 86_400_000);
    expect(byId.get(FRESH)!.status).toBe("active");
    expect(all.items[0].id).toBe(FRESH);
    const nulls = all.items.filter((i) => i.last_active === null).map((i) => i.id);
    expect(all.items.slice(-nulls.length).map((i) => i.id).sort()).toEqual(nulls.sort());
  });

  it("segments list learners only and match the counts", () => {
    const ids = (segment: string) => directory(segment).items.map((i) => i.id).sort();
    expect(ids("never_answered")).toEqual([SILENT].sort());
    expect(ids("onboarding_incomplete")).toEqual([SILENT]);
    expect(ids("no_exam_date")).toEqual([STALE, SILENT].sort());
    expect(ids("pro_inactive_7d")).toEqual([PRO]);
    expect(ids("exam_30d")).toEqual([PRO]);
    const counts = json<Record<string, number>>("SET ROLE service_role; SELECT public.admin_user_segment_counts()::text;");
    expect(counts).toEqual({ learners: 4, never_answered: 1, onboarding_incomplete: 1, no_exam_date: 2, pro_inactive_7d: 1, exam_30d: 1 });
    expect(sql("SET ROLE service_role; SELECT public.admin_user_directory_v2(NULL, 'all', 'all', 'everyone', 'last_active', 'desc', 25, 0);", true).status).not.toBe(0);
  });

  it("Ops decisions: system.read for the feed, users.read for one learner", () => {
    const feed = json<{ total: number; items: Array<{ event: string; user_id: string | null; reason: string | null; actor_email: string | null }> }>(
      `SET ROLE service_role; SELECT public.admin_ops_decisions('${OWNER}', NULL, 50, NULL)::text;`,
    );
    expect(feed.total).toBe(3);
    expect(feed.items.map((i) => i.event)).toEqual(["action.rejected", "action.succeeded", "action.approved"]);
    expect(feed.items[2]).toMatchObject({ actor_email: "user-5d9d6ceb@example.com", user_id: PRO, reason: "Support goodwill" });
    const learner = json<{ total: number }>(`SET ROLE service_role; SELECT public.admin_ops_decisions('${READER}', '${PRO}', 50, NULL)::text;`);
    expect(learner.total).toBe(2);
    const denied = sql(`SET ROLE service_role; SELECT public.admin_ops_decisions('${READER}', NULL, 50, NULL);`, true);
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toMatch(/Admin permission required/);
    expect(sql(`SET ROLE service_role; SELECT count(*) FROM public.ops_audit;`, true).status).not.toBe(0);
  });

  it("only service_role may execute the new functions", () => {
    for (const fn of [
      "public.admin_user_directory_v2(text, text, text, text, text, text, integer, integer)",
      "public.admin_user_segment_counts()",
      "public.admin_ops_decisions(uuid, uuid, integer, timestamptz)",
      "public.admin_is_learner_event(text)",
    ]) {
      expect(rows(`SELECT has_function_privilege('anon', '${fn}', 'EXECUTE')::text || has_function_privilege('authenticated', '${fn}', 'EXECUTE')::text || has_function_privilege('service_role', '${fn}', 'EXECUTE')::text;`)).toBe("falsefalsetrue");
    }
  });

  it("re-applies cleanly and rolls back", () => {
    sql(migration);
    expect(directory("all").total).toBe(6);
    sql(rollback);
    expect(rows("SELECT count(*) FROM pg_proc WHERE proname IN ('admin_user_directory_v2','admin_user_segment_counts','admin_ops_decisions','admin_is_learner_event');")).toBe("0");
    sql(migration);
    expect(directory("never_answered").total).toBe(1);
  });
});
