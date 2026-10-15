import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// referral-enable-active30 proof on a throwaway PostgreSQL 16 cluster:
//  * dry-run.sql is read-only and names exactly the accounts up.sql enables;
//  * up.sql flips users.referrals_enabled only for non-banned, non-staff,
//    real learner accounts with an answer in the last 30 days,
//    compare-and-set, one audit row with the ids, returns the count;
//  * a rerun writes nothing; a missing audit actor refuses;
//  * down.sql restores exactly those ids; stage one (mentor-referral-enable)
//    and stage two roll back independently.
// Opt-in only (test:db:referral-enable-active30); never reads a connection
// URL or production env.
const databaseEnabled = process.env.REFERRAL_ENABLE_ACTIVE30_DATABASE_TESTS === "1";
const PORT = "55473";
let pgBin = "";
function discoverPgBin() {
  if (process.env.MRE_PG_BIN) return resolve(process.env.MRE_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set MRE_PG_BIN or add them to PATH.");
}

const dir = "scripts/sql/track-a/referral-enable-active30";
const read = (path: string) => readFileSync(resolve(path), "utf8");
const up = read(`${dir}/up.sql`);
const down = read(`${dir}/down.sql`);
const dryRun = read(`${dir}/dry-run.sql`);
const stageOneUp = read("scripts/sql/track-a/mentor-referral-enable/up.sql");
const stageOneDown = read("scripts/sql/track-a/mentor-referral-enable/down.sql");

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
const sql = (text: string, allowFailure = false) => psql(text, true, allowFailure);
const rows = (text: string) => sql(text).stdout.trim();

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const ADMIN = id(1);
const L = {
  oneDay: id(101), // one answer yesterday: enabled (stage one would skip it)
  twoDays: id(102), // 2 Vienna days in 14: stage one and stage two
  telegramOnly: id(103), // no email, Telegram id: enabled
  day29: id(104), // only answer 29 days ago: enabled
  bannedNull: id(105), // is_banned NULL counts as not banned: enabled
  day31: id(201), // only answer 31 days ago
  banned: id(204),
  admin: id(205),
  adminTier: id(206),
  staff: id(207),
  testWord: id(208),
  invalid: id(209),
  already: id(210), // enabled before any script
  noIdentity: id(211),
  noAnswers: id(213),
};
const ENABLED = [L.oneDay, L.twoDays, L.telegramOnly, L.day29, L.bannedNull].sort();

function seed() {
  sql(`TRUNCATE public.admin_audit_log, public.answer_history; DELETE FROM public.users;
    INSERT INTO public.users (id, email, telegram_id, role, tier, is_banned, referrals_enabled) VALUES
      ('${ADMIN}', 'admin@medpruf.com', NULL, 'admin', 'admin', false, false),
      ('${L.oneDay}', 'user-25db5126@example.com', NULL, 'user', 'free', false, false),
      ('${L.twoDays}', 'user-f9a9f277@example.com ', NULL, 'user', 'pro', false, false),
      ('${L.telegramOnly}', NULL, 4242, 'user', 'free', false, false),
      ('${L.day29}', 'user-33a3baa3@example.com', NULL, 'user', 'free', false, false),
      ('${L.bannedNull}', 'user-78e29e53@example.com', NULL, 'user', 'free', NULL, false),
      ('${L.day31}', 'user-7da1e4dc@example.com', NULL, 'user', 'free', false, false),
      ('${L.banned}', 'user-52689e0d@example.com', NULL, 'user', 'free', true, false),
      ('${L.admin}', 'user-2c29eeb5@example.com', NULL, 'admin', 'free', false, false),
      ('${L.adminTier}', 'user-6a12df07@example.com', NULL, 'user', 'admin', false, false),
      ('${L.staff}', 'user-73bd246f@example.com', NULL, 'user', 'free', false, false),
      ('${L.testWord}', 'user-d1f08d71@example.com', NULL, 'user', 'free', false, false),
      ('${L.invalid}', 'x@y.invalid', NULL, 'user', 'free', false, false),
      ('${L.already}', 'user-e9521553@example.com', NULL, 'user', 'free', false, true),
      ('${L.noIdentity}', NULL, NULL, 'user', 'free', false, false),
      ('${L.noAnswers}', 'user-c7ed65f4@example.com', NULL, 'user', 'free', false, false);`);
  const yesterday = [L.oneDay, L.telegramOnly, L.bannedNull, L.banned, L.admin, L.adminTier, L.staff, L.testWord, L.invalid, L.already, L.noIdentity];
  const answers: string[] = yesterday.map((u) => `('${u}', now() - interval '1 day')`);
  answers.push(`('${L.twoDays}', now() - interval '1 day'), ('${L.twoDays}', now() - interval '4 days')`);
  answers.push(`('${L.day29}', now() - interval '29 days')`);
  answers.push(`('${L.day31}', now() - interval '31 days')`);
  answers.push(`(NULL, now() - interval '1 day')`);
  sql(`INSERT INTO public.answer_history (user_id, created_at) VALUES ${answers.join(",\n")};`);
}

const enabledIds = () => rows("SELECT string_agg(id::text, ',' ORDER BY id) FROM public.users WHERE referrals_enabled;").split(",").filter(Boolean);
const auditCount = (action: string) => Number(rows(`SELECT count(*) FROM public.admin_audit_log WHERE action = '${action}';`));

describe.skipIf(!databaseEnabled)("referral-enable-active30 on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "rea30-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
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

  it("shares stage one's advisory lock; the dry run is read-only", () => {
    for (const text of [up, down, stageOneUp, stageOneDown]) expect(text).toContain("pg_advisory_xact_lock(hashtext('mentor_referral_enable'))");
    expect(dryRun).toMatch(/BEGIN TRANSACTION READ ONLY;[\s\S]*ROLLBACK;/);
    expect(up).toContain("PRE-FLIGHT: confirm REFERRAL_EXAM_REWARD_ENABLED=true");
  });

  it("dry-run names exactly the accounts up.sql enables and writes nothing", () => {
    const out = psql(dryRun, false).stdout.trim();
    const [count, uid8s] = out.split("|");
    expect(Number(count)).toBe(ENABLED.length);
    expect(uid8s.split(" ")).toEqual(ENABLED.map((u) => u.slice(0, 8)));
    expect(out).not.toMatch(/@/);
    expect(enabledIds()).toEqual([L.already]);
    expect(rows(up)).toMatch(new RegExp(`^${ENABLED.length}\\|[0-9a-f-]{36}$`));
    expect(enabledIds()).toEqual([...ENABLED, L.already].sort());
  });

  it("enables learners active in 30 days, compare-and-set, one audit row with the ids", () => {
    expect(rows(up).split("|")[0]).toBe(String(ENABLED.length));
    expect(auditCount("referral_enable_active30")).toBe(1);
    const payload = JSON.parse(rows("SELECT payload FROM public.admin_audit_log WHERE action = 'referral_enable_active30';"));
    expect([...payload.ids].sort()).toEqual(ENABLED);
    expect(payload.ids).not.toContain(L.already);
    expect(payload.ids).not.toContain(L.day31);
    expect(rows("SELECT actor_id::text || '|' || actor_email || '|' || target_type FROM public.admin_audit_log;")).toBe(`${ADMIN}|admin@medpruf.com|user`);
    expect(rows("SELECT count(*) FROM public.users WHERE is_banned IS TRUE AND referrals_enabled;")).toBe("0");
  });

  it("a rerun enables nobody and writes no second audit row", () => {
    rows(up);
    expect(rows(up)).toBe("0|");
    expect(auditCount("referral_enable_active30")).toBe(1);
  });

  it("refuses without the admin audit actor and writes nothing", () => {
    sql(`UPDATE public.users SET role = 'user' WHERE id = '${ADMIN}';`);
    const result = sql(up, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/admin owner account not found/);
    expect(enabledIds()).toEqual([L.already]);
  });

  it("after stage one, stage two enables only the rest; each rollback restores its own ids", () => {
    expect(rows(stageOneUp).split("|")[0]).toBe("1"); // only twoDays has 2 Vienna days
    expect(rows(up).split("|")[0]).toBe(String(ENABLED.length - 1));
    const payload = JSON.parse(rows("SELECT payload FROM public.admin_audit_log WHERE action = 'referral_enable_active30';"));
    expect(payload.ids).not.toContain(L.twoDays);
    // Stage two rollback leaves stage one's account enabled.
    expect(rows(down).split("|")[0]).toBe(String(ENABLED.length - 1));
    expect(enabledIds()).toEqual([L.twoDays, L.already].sort());
    // Stage one rollback reads only its own audit row.
    expect(rows(stageOneDown).split("|")[0]).toBe("1");
    expect(enabledIds()).toEqual([L.already]);
    expect(auditCount("referral_enable_active30_rollback")).toBe(1);
    expect(auditCount("mentor_referral_enable_rollback")).toBe(1);
  });

  it("down restores exactly the enabled ids and refuses a second time", () => {
    rows(up);
    sql(`UPDATE public.users SET referrals_enabled = true WHERE id = '${L.day31}';`);
    expect(rows(down).split("|")[0]).toBe(String(ENABLED.length));
    expect(enabledIds()).toEqual([L.day31, L.already].sort());
    const again = sql(down, true);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toMatch(/nothing to roll back/);
  });

  it("down refuses when up.sql never ran, even after a stage one enable", () => {
    rows(stageOneUp);
    const result = sql(down, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/nothing to roll back/);
  });
});
