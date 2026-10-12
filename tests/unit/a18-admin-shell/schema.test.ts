import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a18 proof on a throwaway PostgreSQL 16 cluster: the unapplied
// 20261205090000 changeset takes the ten admin tables out of
// supabase_realtime, leaves every other published table alone, is
// idempotent, refuses a FOR ALL TABLES publication, and the rollback puts the
// tables back. Opt-in only (test:db:a18); never reads a connection URL or
// production env.
const databaseEnabled = process.env.A18_DATABASE_TESTS === "1";
const PORT = "55441";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A18_PG_BIN) return resolve(process.env.A18_PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  const config = spawnSync("pg_config", ["--bindir"], { encoding: "utf8", timeout: 10_000 });
  if (config.status === 0 && config.stdout.trim()) return config.stdout.trim();
  throw new Error("PostgreSQL 16 binaries required for test:db:a18. Set A18_PG_BIN or add them to PATH.");
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const original = read("supabase/migrations/20260423950000_realtime_publications.sql");
const migration = read("supabase/migrations/20261205090000_a18_admin_realtime_off.sql");
const rollback = read("scripts/sql/track-a/a18-admin-shell/down.sql");
const ADMIN_TABLES = [
  "admin_audit_log", "cron_runs", "exam_attempts", "jobs", "processed_webhook_events",
  "referrals", "subscriptions", "user_events", "user_feedback", "waitlist",
];

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
const published = () => rows("SELECT coalesce(string_agg(tablename, ',' ORDER BY tablename), '') FROM pg_publication_tables WHERE pubname = 'supabase_realtime';");

describe.skipIf(!databaseEnabled)("a18 admin realtime off on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a18-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h '' -c wal_level=logical`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    // The ten admin tables plus one learner-facing table that must stay published.
    sql(`${ADMIN_TABLES.map((t) => `CREATE TABLE public.${t} (id bigserial PRIMARY KEY);`).join("\n")}
      CREATE TABLE public.notes (id bigserial PRIMARY KEY);
      CREATE PUBLICATION supabase_realtime;
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;`);
    sql(original);
  });

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("starts from the April 23 publication", () => {
    expect(published()).toBe([...ADMIN_TABLES, "notes"].sort().join(","));
  });

  it("removes exactly the admin tables and keeps the rest", () => {
    sql(migration);
    expect(published()).toBe("notes");
  });

  it("is idempotent", () => {
    sql(migration);
    expect(published()).toBe("notes");
  });

  it("rollback restores the admin tables and is idempotent", () => {
    sql(rollback);
    sql(rollback);
    expect(published()).toBe([...ADMIN_TABLES, "notes"].sort().join(","));
    sql(migration);
    expect(published()).toBe("notes");
  });

  it("is a no-op without the publication, rollback too", () => {
    sql("DROP PUBLICATION supabase_realtime;");
    sql(migration);
    sql(rollback);
    expect(rows("SELECT count(*) FROM pg_publication;")).toBe("0");
  });

  it("refuses a FOR ALL TABLES publication", () => {
    sql("CREATE PUBLICATION supabase_realtime FOR ALL TABLES;");
    const result = sql(migration, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/FOR ALL TABLES/);
    sql(rollback);
    sql("DROP PUBLICATION supabase_realtime;");
  });
});
