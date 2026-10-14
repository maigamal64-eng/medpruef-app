import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// mentor-referral-enable proof on a throwaway PostgreSQL 16 cluster:
//  * dry-run.sql is read-only and names exactly the accounts up.sql enables;
//  * up.sql flips users.referrals_enabled only for non-banned, non-staff,
//    real learner accounts with answers on >= 2 Vienna days in the last 14
//    days, compare-and-set, one audit row with the ids, returns the count;
//  * a rerun writes nothing; a missing audit actor refuses;
//  * down.sql restores exactly those ids and leaves every other account alone.
// Opt-in only (test:db:mentor-referral-enable); never reads a connection URL
// or production env.
const databaseEnabled = process.env.MENTOR_REFERRAL_ENABLE_DATABASE_TESTS === "1";
const PORT = "55471";
let pgBin = "";
function discoverPgBin() {
  if (process.env.MRE_PG_BIN) return resolve(process.env.MRE_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set MRE_PG_BIN or add them to PATH.");
}

const dir = "scripts/sql/track-a/mentor-referral-enable";
const read = (path: string) => readFileSync(resolve(path), "utf8");
const up = read(`${dir}/up.sql`);
const down = read(`${dir}/down.sql`);
const dryRun = read(`${dir}/dry-run.sql`);

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };

function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 30_000 });
  if (result.error) throw result.error;
  return result;
}
function psql(text: string, single: boolean, allowFailure = false) {
  const args = ["-X", ...(single ? ["-1"] : []), "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-F", "|"];
  const result = binary("psql", args, text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
// -1: up/down run as one transaction, the way the runbook says.
const sql = (text: string, allowFailure = false) => psql(text, true, allowFailure);
const rows = (text: string) => sql(text).stdout.trim();

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ADMIN = id(1);
const L = {
  twoDays: id(101), // active on 2 Vienna days: enabled
  threeDays: id(102), // active on 3 days: enabled
  telegramOnly: id(103), // no email, Telegram id, 2 days: enabled
  oneDay: id(201), // many answers, one Vienna day
  viennaSameDay: id(202), // two UTC dates, one Vienna day (22:30 and 23:30 UTC in summer time)
  old: id(203), // second day 15 days ago
  banned: id(204),
  admin: id(205),
  adminTier: id(206),
  staff: id(207), // @medpruf.com
  testWord: id(208), // test word in email
  invalid: id(209), // .invalid domain
  already: id(210), // already enabled before up.sql
  noIdentity: id(211), // neither email nor telegram id
  bannedNull: id(212), // is_banned NULL counts as not banned: enabled
  noAnswers: id(213),
};
const ENABLED = [L.twoDays, L.threeDays, L.telegramOnly, L.bannedNull].sort();

function seed() {
  sql(`TRUNCATE public.admin_audit_log, public.answer_history; DELETE FROM public.users;
    INSERT INTO public.users (id, email, telegram_id, role, tier, is_banned, referrals_enabled) VALUES
      ('${ADMIN}', 'admin@medpruf.com', NULL, 'admin', 'admin', false, false),
      ('${L.twoDays}', 'user-25db5126@example.com', NULL, 'user', 'free', false, false),
      ('${L.threeDays}', 'user-f9a9f277@example.com ', NULL, 'user', 'pro', false, false),
      ('${L.telegramOnly}', NULL, 4242, 'user', 'free', false, false),
      ('${L.oneDay}', 'user-cf03ded3@example.com', NULL, 'user', 'free', false, false),
      ('${L.viennaSameDay}', 'user-a00fbf73@example.com', NULL, 'user', 'free', false, false),
      ('${L.old}', 'user-7da1e4dc@example.com', NULL, 'user', 'free', false, false),
      ('${L.banned}', 'user-52689e0d@example.com', NULL, 'user', 'free', true, false),
      ('${L.admin}', 'user-2c29eeb5@example.com', NULL, 'admin', 'free', false, false),
      ('${L.adminTier}', 'user-6a12df07@example.com', NULL, 'user', 'admin', false, false),
      ('${L.staff}', 'user-37b65874@example.com', NULL, 'user', 'free', false, false),
      ('${L.testWord}', 'user-830e23bd@example.com', NULL, 'user', 'free', false, false),
      ('${L.invalid}', 'x@y.invalid', NULL, 'user', 'free', false, false),
      ('${L.already}', 'user-e9521553@example.com', NULL, 'user', 'free', false, true),
      ('${L.noIdentity}', NULL, NULL, 'user', 'free', false, false),
      ('${L.bannedNull}', 'user-78e29e53@example.com', NULL, 'user', 'free', NULL, false),
      ('${L.noAnswers}', 'user-c7ed65f4@example.com', NULL, 'user', 'free', false, false);`);
  const twoDayIds = [L.twoDays, L.telegramOnly, L.banned, L.admin, L.adminTier, L.staff, L.testWord, L.invalid, L.already, L.noIdentity, L.bannedNull];
  const answers: string[] = [];
  for (const u of twoDayIds) answers.push(`('${u}', now() - interval '1 day'), ('${u}', now() - interval '5 days')`);
  answers.push(`('${L.threeDays}', now() - interval '1 day'), ('${L.threeDays}', now() - interval '3 days'), ('${L.threeDays}', now() - interval '13 days')`);
  answers.push(`('${L.oneDay}', date_trunc('day', now() AT TIME ZONE 'Europe/Vienna') AT TIME ZONE 'Europe/Vienna' + interval '1 minute'), ('${L.oneDay}', date_trunc('day', now() AT TIME ZONE 'Europe/Vienna') AT TIME ZONE 'Europe/Vienna' + interval '2 minutes')`);
  // 00:30 and 23:00 Vienna on one day are two different UTC dates: still one Vienna day.
  answers.push(`('${L.viennaSameDay}', (date_trunc('day', (now() - interval '3 days') AT TIME ZONE 'Europe/Vienna') + interval '30 minutes') AT TIME ZONE 'Europe/Vienna'), ('${L.viennaSameDay}', (date_trunc('day', (now() - interval '3 days') AT TIME ZONE 'Europe/Vienna') + interval '23 hours') AT TIME ZONE 'Europe/Vienna')`);
  answers.push(`('${L.old}', now() - interval '1 day'), ('${L.old}', now() - interval '15 days')`);
  answers.push(`(NULL, now() - interval '1 day'), (NULL, now() - interval '2 days')`);
  sql(`INSERT INTO public.answer_history (user_id, created_at) VALUES ${answers.join(",\n")};`);
}

const enabledIds = () => rows("SELECT string_agg(id::text, ',' ORDER BY id) FROM public.users WHERE referrals_enabled;").split(",").filter(Boolean);
const auditCount = (action: string) => Number(rows(`SELECT count(*) FROM public.admin_audit_log WHERE action = '${action}';`));

describe.skipIf(!databaseEnabled)("mentor-referral-enable on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "mre-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    // Minimal shapes of the production columns the scripts read and write.
    sql(`CREATE TABLE public.users (
        id uuid PRIMARY KEY, email text UNIQUE, telegram_id bigint UNIQUE, role text NOT NULL DEFAULT 'user',
        tier text NOT NULL DEFAULT 'free', is_banned boolean DEFAULT false, referrals_enabled boolean NOT NULL DEFAULT false,
        updated_at timestamptz DEFAULT now());
      CREATE TABLE public.answer_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, question_id integer, created_at timestamptz DEFAULT now());
      CREATE TABLE public.admin_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        actor_email text NOT NULL, action text NOT NULL, target_type text, target_id uuid,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb, ip_address inet, user_agent text, created_at timestamptz NOT NULL DEFAULT clock_timestamp());`);
  });

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  beforeEach(() => seed());

  it("enable and rollback take the same advisory lock, so overlapping runs serialise", () => {
    for (const text of [up, down]) expect(text).toContain("pg_advisory_xact_lock(hashtext('mentor_referral_enable'))");
    expect(dryRun).toMatch(/BEGIN TRANSACTION READ ONLY;[\s\S]*ROLLBACK;/);
  });

  it("dry-run is read-only and names exactly the accounts up.sql enables", () => {
    const out = psql(dryRun, false).stdout.trim();
    const [count, uid8s] = out.split("|");
    expect(Number(count)).toBe(ENABLED.length);
    expect(uid8s.split(" ")).toEqual(ENABLED.map((u) => u.slice(0, 8)));
    expect(out).not.toMatch(/@/);
    expect(enabledIds()).toEqual([L.already]);
    expect(auditCount("mentor_referral_enable")).toBe(0);
    // up.sql then enables exactly that set.
    expect(rows(up)).toMatch(new RegExp(`^${ENABLED.length}\\|[0-9a-f-]{36}$`));
    expect(enabledIds()).toEqual([...ENABLED, L.already].sort());
  });

  it("enables only active learners, compare-and-set, with one audit row holding the ids", () => {
    expect(rows(up).split("|")[0]).toBe(String(ENABLED.length));
    expect(enabledIds()).toEqual([...ENABLED, L.already].sort());
    expect(auditCount("mentor_referral_enable")).toBe(1);
    const payload = JSON.parse(rows("SELECT payload FROM public.admin_audit_log WHERE action = 'mentor_referral_enable';"));
    expect(payload.count).toBe(ENABLED.length);
    expect([...payload.ids].sort()).toEqual(ENABLED);
    expect(payload.ids).not.toContain(L.already);
    expect(rows("SELECT actor_id::text || '|' || actor_email || '|' || target_type FROM public.admin_audit_log;")).toBe(`${ADMIN}|admin@medpruf.com|user`);
    // Nothing but the flag changed.
    expect(rows("SELECT count(*) FROM public.users WHERE is_banned IS TRUE AND referrals_enabled;")).toBe("0");
  });

  it("a rerun enables nobody and writes no second audit row", () => {
    rows(up);
    expect(rows(up)).toBe("0|");
    expect(auditCount("mentor_referral_enable")).toBe(1);
  });

  it("refuses without the admin audit actor and writes nothing", () => {
    sql(`UPDATE public.users SET role = 'user' WHERE id = '${ADMIN}';`);
    const result = sql(up, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/admin owner account not found/);
    expect(enabledIds()).toEqual([L.already]);
    expect(auditCount("mentor_referral_enable")).toBe(0);
  });

  it("down restores exactly the enabled ids and leaves other accounts alone", () => {
    rows(up);
    // An account enabled by another path after up.sql stays enabled.
    sql(`UPDATE public.users SET referrals_enabled = true WHERE id = '${L.oneDay}';`);
    expect(rows(down).split("|")[0]).toBe(String(ENABLED.length));
    expect(enabledIds()).toEqual([L.oneDay, L.already].sort());
    const payload = JSON.parse(rows("SELECT payload FROM public.admin_audit_log WHERE action = 'mentor_referral_enable_rollback';"));
    expect([...payload.ids].sort()).toEqual(ENABLED);
    expect(payload.enable_audit_id).toBe(rows("SELECT id FROM public.admin_audit_log WHERE action = 'mentor_referral_enable';"));
    // A second down has nothing left to roll back.
    const again = sql(down, true);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toMatch(/nothing to roll back/);
    expect(auditCount("mentor_referral_enable_rollback")).toBe(1);
  });

  it("down refuses when up.sql never ran", () => {
    const result = sql(down, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/nothing to roll back/);
    expect(enabledIds()).toEqual([L.already]);
  });

  it("after a rollback, up.sql can run again and down reverts the newest run", () => {
    rows(up);
    rows(down);
    expect(rows(up).split("|")[0]).toBe(String(ENABLED.length));
    expect(rows(down).split("|")[0]).toBe(String(ENABLED.length));
    expect(enabledIds()).toEqual([L.already]);
    expect(auditCount("mentor_referral_enable")).toBe(2);
    expect(auditCount("mentor_referral_enable_rollback")).toBe(2);
  });
});
