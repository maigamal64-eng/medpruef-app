import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a30 proof on a throwaway PostgreSQL 16 cluster: the b19 study-nudge
// migration as applied in production, then the unapplied 20270101090000
// changeset (hour, Telegram channel, per-destination consent suspension), its
// idempotency, privileges and rollback. Opt-in only (test:db:a30); never reads
// a connection URL or production env.
const databaseEnabled = process.env.A30_DATABASE_TESTS === "1";
const PORT = "55463";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A30_PG_BIN) return resolve(process.env.A30_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a30. Set A30_PG_BIN.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const b19 = read("supabase/migrations/20261111100000_study_nudge.sql");
const migration = read("supabase/migrations/20270101090000_a30_study_nudge_channels.sql");
const fixture = read("scripts/sql/track-a/a30-senders/fixture.sql");
const rollback = read("scripts/sql/track-a/a30-senders/down.sql");
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";

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
const fails = (text: string) => sql(text, true).status !== 0;
const checks = () => rows(`
  SELECT string_agg(conrelid::regclass || ':' || pg_get_constraintdef(oid), E'\\n' ORDER BY conrelid::regclass::text, pg_get_constraintdef(oid))
  FROM pg_constraint WHERE contype = 'c' AND conrelid IN ('public.study_nudge_prefs'::regclass, 'public.study_nudge_sends'::regclass);`);
const triggerDef = () => rows(`SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'suspend_study_consent_on_email_change';`);
const pref = (user: string) => rows(`SELECT opt_in || '|' || channel || '|' || coalesce(consent_email, '-') || '|' || coalesce(consent_telegram_id::text, '-') FROM public.study_nudge_prefs WHERE user_id = '${user}';`);

describe.skipIf(!databaseEnabled)("a30 study nudge channels on isolated PostgreSQL 16", () => {
  let b19Checks = "";
  let b19Trigger = "";
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a30-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    sql(b19);
    b19Checks = checks();
    b19Trigger = triggerDef();
    // An existing b19 email opt-in survives the changeset.
    sql(`
      INSERT INTO public.users (id, email, telegram_id, telegram_chat_id_confirmed) VALUES
        ('${A}', 'a@example.invalid', 111, now()), ('${B}', 'b@example.invalid', 222, now());
      INSERT INTO public.study_nudge_prefs (user_id, opt_in, consent_email, consent_confirmed_at, consent_version)
        VALUES ('${A}', true, 'a@example.invalid', now(), 1);
    `);
    sql(migration);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("keeps the existing email opt-in and gives it the b19 hour", () => {
    expect(pref(A)).toBe("true|email|a@example.invalid|-");
    expect(rows(`SELECT hour FROM public.study_nudge_prefs WHERE user_id = '${A}';`)).toBe("9");
  });

  it("is idempotent: a second apply changes no constraint or trigger", () => {
    const before = checks();
    sql(migration);
    expect(checks()).toBe(before);
    expect(before).toContain("telegram");
    expect(before).not.toMatch(/CHECK \(\(channel = 'email'::text\)\)/);
    expect(triggerDef()).toMatch(/BEFORE UPDATE OF email, telegram_id ON public\.users/);
  });

  it("accepts a bound Telegram opt-in and refuses an unbound one", () => {
    expect(fails(`SET ROLE service_role; INSERT INTO public.study_nudge_prefs (user_id, opt_in, channel, consent_confirmed_at, consent_version) VALUES ('${B}', true, 'telegram', now(), 1);`)).toBe(true);
    sql(`SET ROLE service_role; INSERT INTO public.study_nudge_prefs (user_id, opt_in, channel, hour, consent_telegram_id, consent_confirmed_at, consent_version) VALUES ('${B}', true, 'telegram', 20, 222, now(), 1);`);
    expect(pref(B)).toBe("true|telegram|-|222");
    // An email opt-in still needs its confirmed address.
    expect(fails(`SET ROLE service_role; UPDATE public.study_nudge_prefs SET channel = 'email' WHERE user_id = '${B}';`)).toBe(true);
    expect(fails(`SET ROLE service_role; UPDATE public.study_nudge_prefs SET channel = 'push' WHERE user_id = '${B}';`)).toBe(true);
  });

  it("allows hours 06..22 only", () => {
    expect(fails(`UPDATE public.study_nudge_prefs SET hour = 5 WHERE user_id = '${A}';`)).toBe(true);
    expect(fails(`UPDATE public.study_nudge_prefs SET hour = 23 WHERE user_id = '${A}';`)).toBe(true);
    sql(`UPDATE public.study_nudge_prefs SET hour = 22 WHERE user_id = '${A}';`);
    expect(rows(`SELECT hour FROM public.study_nudge_prefs WHERE user_id = '${A}';`)).toBe("22");
  });

  it("logs a Telegram send with its kind, one per pref, day and channel", () => {
    const prefB = rows(`SELECT id FROM public.study_nudge_prefs WHERE user_id = '${B}';`);
    sql(`SET ROLE service_role; INSERT INTO public.study_nudge_sends (pref_id, nudge_day, channel, kind) VALUES ('${prefB}', '2026-10-12', 'telegram', 'due_streak');`);
    expect(fails(`SET ROLE service_role; INSERT INTO public.study_nudge_sends (pref_id, nudge_day, channel, kind) VALUES ('${prefB}', '2026-10-12', 'telegram', 'due');`)).toBe(true);
    expect(fails(`SET ROLE service_role; INSERT INTO public.study_nudge_sends (pref_id, nudge_day, channel, kind) VALUES ('${prefB}', '2026-10-13', 'telegram', 'loss');`)).toBe(true);
  });

  it("suspends only the consent of the destination that changed", () => {
    // B (Telegram) changes email: Telegram consent stays.
    sql(`UPDATE public.users SET email = 'b2@example.invalid' WHERE id = '${B}';`);
    expect(pref(B)).toBe("true|telegram|-|222");
    // A (email) changes Telegram id: email consent stays.
    sql(`UPDATE public.users SET telegram_id = 333 WHERE id = '${A}';`);
    expect(pref(A)).toBe("true|email|a@example.invalid|-");
    // Each destination change suspends its own channel.
    sql(`UPDATE public.users SET telegram_id = 444 WHERE id = '${B}';`);
    expect(pref(B)).toBe("false|telegram|-|-");
    sql(`UPDATE public.users SET email = 'A@Example.invalid ' WHERE id = '${A}';`);
    expect(pref(A)).toBe("true|email|a@example.invalid|-");
    sql(`UPDATE public.users SET email = 'a-new@example.invalid' WHERE id = '${A}';`);
    expect(pref(A)).toBe("false|email|-|-");
  });

  it("stays closed to anon and authenticated", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(fails(`SET ROLE ${role}; SELECT 1 FROM public.study_nudge_prefs;`)).toBe(true);
      expect(fails(`SET ROLE ${role}; SELECT 1 FROM public.study_nudge_sends;`)).toBe(true);
    }
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.study_nudge_prefs'::regclass;`)).toBe("t");
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.study_nudge_sends'::regclass;`)).toBe("t");
  });

  it("rolls back to the exact b19 shape and re-applies", () => {
    // Put a Telegram opt-in back so the rollback has to fold it.
    sql(`UPDATE public.study_nudge_prefs SET opt_in = true, consent_telegram_id = 444, consent_confirmed_at = now(), consent_version = 1 WHERE user_id = '${B}';`);
    sql(rollback);
    expect(checks()).toBe(b19Checks);
    expect(triggerDef()).toBe(b19Trigger);
    expect(rows(`SELECT count(*) FROM information_schema.columns WHERE table_name IN ('study_nudge_prefs','study_nudge_sends') AND column_name IN ('hour','consent_telegram_id','kind');`)).toBe("0");
    expect(rows(`SELECT opt_in || '|' || channel FROM public.study_nudge_prefs WHERE user_id = '${B}';`)).toBe("false|email");
    expect(rows(`SELECT count(*) FROM public.study_nudge_sends WHERE channel = 'telegram';`)).toBe("0");
    sql(migration);
    sql(migration);
    expect(triggerDef()).toMatch(/OF email, telegram_id/);
    sql(rollback);
    expect(checks()).toBe(b19Checks);
  });
});
