import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-intercom-marketing-consent: 20270114090000 on a throwaway PostgreSQL 16
// cluster. New and existing accounts read marketing_opt_in = false; an opt-in
// without its time and text version is refused; up is idempotent; down drops
// exactly the three columns and the constraint and up re-applies after it.
// Opt-in only (npm run test:db:a-marketing-consent); never reads a
// connection URL or production env.
const databaseEnabled = process.env.A_MARKETING_CONSENT_DATABASE_TESTS === "1";
const PORT = "55477";
let pgBin = "";
function discoverPgBin() {
  if (process.env.MRE_PG_BIN) return resolve(process.env.MRE_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set MRE_PG_BIN or add them to PATH.");
}

const up = readFileSync(resolve("supabase/migrations/20270114090000_a_marketing_consent.sql"), "utf8");
const down = readFileSync(resolve("scripts/sql/track-a/a-marketing-consent/down.sql"), "utf8");

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
  const args = ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-F", "|"];
  const result = binary("psql", args, text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const consentColumns = () => rows(`SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' ORDER BY column_name)
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name LIKE 'marketing%';`);

describe.skipIf(!databaseEnabled)("20270114090000_a_marketing_consent on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "amc-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    sql(`CREATE TABLE public.users (
        id uuid PRIMARY KEY, email text UNIQUE, password_hash text, first_name text, role text NOT NULL DEFAULT 'user',
        tier text NOT NULL DEFAULT 'free', created_at timestamptz DEFAULT now());
      INSERT INTO public.users (id, email) VALUES ('${id(1)}', 'before@example.org');`);
  });

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("adds the three columns; existing rows read false, nothing else changes", () => {
    sql(up);
    expect(consentColumns()).toBe([
      "marketing_consent_at:timestamp with time zone:YES:-",
      "marketing_consent_version:text:YES:-",
      "marketing_opt_in:boolean:NO:false",
    ].join(","));
    expect(rows(`SELECT marketing_opt_in, marketing_consent_at IS NULL, marketing_consent_version IS NULL FROM public.users WHERE id = '${id(1)}';`)).toBe("f|t|t");
    expect(rows("SELECT convalidated FROM pg_constraint WHERE conname = 'users_marketing_consent_recorded';")).toBe("t");
  });

  it("a new account without the field is not opted in (the register insert names none of the columns)", () => {
    sql(`INSERT INTO public.users (id, email, password_hash, first_name, role) VALUES ('${id(2)}', 'new@example.org', 'x', 'Anna', 'user');`);
    expect(rows(`SELECT marketing_opt_in FROM public.users WHERE id = '${id(2)}';`)).toBe("f");
    expect(sql(`UPDATE public.users SET marketing_opt_in = NULL WHERE id = '${id(2)}';`, true).status).not.toBe(0);
  });

  it("refuses an opt-in without its time and version; accepts the app's write and a withdrawal", () => {
    expect(sql(`UPDATE public.users SET marketing_opt_in = true WHERE id = '${id(2)}';`, true).status).not.toBe(0);
    expect(sql(`UPDATE public.users SET marketing_opt_in = true, marketing_consent_at = now() WHERE id = '${id(2)}';`, true).status).not.toBe(0);
    sql(`UPDATE public.users SET marketing_opt_in = true, marketing_consent_at = now(), marketing_consent_version = 'mc-2026-10-17'
      WHERE id = '${id(2)}' AND marketing_opt_in = false;`);
    expect(rows(`SELECT marketing_opt_in, marketing_consent_version FROM public.users WHERE id = '${id(2)}';`)).toBe("t|mc-2026-10-17");
    sql(`UPDATE public.users SET marketing_opt_in = false, marketing_consent_at = now(), marketing_consent_version = 'mc-2026-10-17'
      WHERE id = '${id(2)}' AND marketing_opt_in = true;`);
    expect(rows(`SELECT marketing_opt_in FROM public.users WHERE id = '${id(2)}';`)).toBe("f");
  });

  it("up is idempotent", () => {
    sql(up);
    expect(rows("SELECT count(*) FROM pg_constraint WHERE conname = 'users_marketing_consent_recorded';")).toBe("1");
  });

  it("down drops exactly the consent columns and constraint; up re-applies", () => {
    sql(down);
    expect(consentColumns()).toBe("");
    expect(rows("SELECT count(*) FROM pg_constraint WHERE conname = 'users_marketing_consent_recorded';")).toBe("0");
    expect(rows("SELECT count(*) FROM public.users;")).toBe("2");
    expect(rows("SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'users';"))
      .toBe("id,email,password_hash,first_name,role,tier,created_at");
    sql(down);
    sql(up);
    expect(rows(`SELECT bool_and(NOT marketing_opt_in) FROM public.users;`)).toBe("t");
  });
});
