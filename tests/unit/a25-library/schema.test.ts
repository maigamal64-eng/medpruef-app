import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a25 proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261224090000 changeset (lifetime note-creation counter), its privileges,
// idempotency and rollback. Opt-in only (test:db:a25); never reads a
// connection URL or production env.
const databaseEnabled = process.env.A25_DATABASE_TESTS === "1";
const PORT = "55461";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A25_PG_BIN) return resolve(process.env.A25_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a25. Set A25_PG_BIN.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const migration = read("supabase/migrations/20261224090000_a25_note_creation_ledger.sql");
const fixture = read("scripts/sql/track-a/a25-study-library/fixture.sql");
const rollback = read("scripts/sql/track-a/a25-study-library/down.sql");
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000a2";
const C = "00000000-0000-4000-8000-0000000000a3";

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
const total = (user: string) => rows(`SELECT coalesce((SELECT created_total FROM public.note_creation_counts WHERE user_id='${user}'), 0);`);

describe.skipIf(!databaseEnabled)("a25 note creation counter on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a25-pg16-"));
    const dataDir = join(cluster, "data");
    expect(binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]).status).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(fixture);
    // Notes that exist before the changeset: A has 3 (one inactive), B has 1.
    sql(`
      INSERT INTO public.users (id) VALUES ('${A}'), ('${B}'), ('${C}');
      INSERT INTO public.notes (user_id, created_at) VALUES ('${A}', now() - interval '3 days'), ('${A}', now() - interval '2 days'), ('${B}', now());
      INSERT INTO public.notes (user_id, is_active) VALUES ('${A}', false);
    `);
    sql(migration);
  });
  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", join(cluster, "data"), "-m", "immediate", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("backfills every existing note, active or not", () => {
    expect(total(A)).toBe("3");
    expect(total(B)).toBe("1");
    expect(total(C)).toBe("0");
    expect(rows(`SELECT first_created_at < now() - interval '2 days' FROM public.note_creation_counts WHERE user_id='${A}';`)).toBe("t");
  });

  it("counts every insert and never gives a slot back on delete", () => {
    sql(`SET ROLE service_role; INSERT INTO public.notes (user_id) VALUES ('${A}');`);
    expect(total(A)).toBe("4");
    sql(`SET ROLE service_role; INSERT INTO public.notes (user_id) VALUES ('${C}'), ('${C}');`);
    expect(total(C)).toBe("2");
    sql(`SET ROLE service_role; DELETE FROM public.notes WHERE user_id='${A}';`);
    expect(rows(`SELECT count(*) FROM public.notes WHERE user_id='${A}';`)).toBe("0");
    expect(total(A)).toBe("4");
    sql(`SET ROLE service_role; INSERT INTO public.notes (user_id) VALUES ('${A}');`);
    expect(total(A)).toBe("5");
  });

  it("is read-only for the app role and closed to anon and authenticated", () => {
    expect(rows(`SET ROLE service_role; SELECT created_total FROM public.note_creation_counts WHERE user_id='${B}';`)).toBe("1");
    for (const write of [
      `UPDATE public.note_creation_counts SET created_total = 0 WHERE user_id='${A}';`,
      `DELETE FROM public.note_creation_counts WHERE user_id='${A}';`,
      `INSERT INTO public.note_creation_counts (user_id, created_total) VALUES ('${B}', 0);`,
      `SELECT public.notes_count_creation();`,
    ]) {
      const denied = sql(`SET ROLE service_role; ${write}`, true);
      expect(denied.status, write).not.toBe(0);
      expect(denied.stderr).toMatch(/permission denied/);
    }
    for (const role of ["anon", "authenticated"]) {
      const denied = sql(`SET ROLE ${role}; SELECT count(*) FROM public.note_creation_counts;`, true);
      expect(denied.status).not.toBe(0);
      expect(denied.stderr).toMatch(/permission denied/);
    }
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.note_creation_counts'::regclass;`)).toBe("t");
    expect(total(A)).toBe("5");
  });

  it("re-applying keeps the counted totals and one trigger", () => {
    sql(migration);
    expect(total(A)).toBe("5");
    expect(total(C)).toBe("2");
    expect(rows(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.notes'::regclass AND NOT tgisinternal;`)).toBe("1");
    sql(`SET ROLE service_role; INSERT INTO public.notes (user_id) VALUES ('${B}');`);
    expect(total(B)).toBe("2");
  });

  it("removes the counter row with the account", () => {
    sql(`DELETE FROM public.users WHERE id='${C}';`);
    expect(rows(`SELECT count(*) FROM public.note_creation_counts WHERE user_id='${C}';`)).toBe("0");
  });

  it("rolls back cleanly and notes keep working", () => {
    sql(rollback);
    expect(rows(`SELECT to_regclass('public.note_creation_counts') IS NULL;`)).toBe("t");
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname = 'notes_count_creation';`)).toBe("0");
    expect(rows(`SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.notes'::regclass AND NOT tgisinternal;`)).toBe("0");
    sql(`SET ROLE service_role; INSERT INTO public.notes (user_id) VALUES ('${A}');`);
    sql(rollback);
    // Re-applying after a rollback rebuilds from the notes that remain.
    sql(migration);
    expect(total(A)).toBe("2");
    expect(total(B)).toBe("2");
  });
});
