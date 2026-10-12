import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a20 proof on a throwaway PostgreSQL 16 cluster:
//  1. 20261206090000 drops the retired admin_exec_select runner, is
//     idempotent, and the rollback recreates it with no role able to run it.
//  2. close-pending-nowpayments.sql closes exactly the nine dead NOWPayments
//     pending rows (status change, never a delete), saves their before-image
//     in one audit row, is idempotent, refuses on any guard, never touches a
//     manual crypto record, and its rollback restores the before-image.
// Opt-in only (test:db:a20); never reads a connection URL or production env.
const databaseEnabled = process.env.A20_DATABASE_TESTS === "1";
const PORT = "55442";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A20_PG_BIN) return resolve(process.env.A20_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a20. Set A20_PG_BIN or add them to PATH.");
}

const read = (path: string) => readFileSync(resolve(path), "utf8");
const original = read("supabase/migrations/20260426060000_admin_exec_select_timeout.sql");
const migration = read("supabase/migrations/20261206090000_a20_drop_admin_exec_select.sql");
const down = read("scripts/sql/track-a/a20-admin-growth-cleanup/down.sql");
const close = read("scripts/sql/track-a/a20-admin-growth-cleanup/close-pending-nowpayments.sql");
const reopen = read("scripts/sql/track-a/a20-admin-growth-cleanup/close-pending-nowpayments.rollback.sql");
const rbacTest = read("supabase/tests/admin_rbac.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };

function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 30_000 });
  if (result.error) throw result.error;
  return result;
}
// -1: every script runs as one transaction, the way the runbook says.
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const LEARNER = "00000000-0000-4000-8000-0000000000b1";
const DEAD = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
const MANUAL = "00000000-0000-4000-8000-000000000201";
const OLD_CANCELLED = "00000000-0000-4000-8000-000000000202";
const WHOP = "00000000-0000-4000-8000-000000000203";

function seedSubscriptions() {
  const dead = DEAD.map((id, i) =>
    `('${id}', '${LEARNER}', '${i === 8 ? "premium_pass_guaranteed" : "first_month_19"}', 'pending', 'nowpayments', 'crypto', ${i === 8 ? 11400 : 1900}, '2026-04-25'::timestamptz + interval '${i * 5} days', '2026-05-01T00:00:00Z', NULL)`,
  ).join(",\n");
  sql(`TRUNCATE public.subscriptions, public.processed_webhook_events, public.admin_audit_log;
    INSERT INTO public.subscriptions (id, user_id, tier, status, payment_provider, payment_method, amount_cents, created_at, updated_at, cancelled_at) VALUES
    ${dead},
    ('${MANUAL}', '${LEARNER}', 'pro_6mo', 'pending', 'manual', 'crypto', 4900, '2026-05-02', '2026-05-02', NULL),
    ('${OLD_CANCELLED}', '${LEARNER}', 'first_month_19', 'cancelled', 'nowpayments', 'crypto', 1900, '2026-04-20', '2026-04-21', '2026-04-21'),
    ('${WHOP}', '${LEARNER}', 'pro', 'active', 'whop', 'card', 1900, '2026-09-01', '2026-09-01', NULL);`);
}
const statusOf = (id: string) => rows(`SELECT status FROM public.subscriptions WHERE id = '${id}';`);
const pendingNow = () => rows("SELECT count(*) FROM public.subscriptions WHERE payment_provider = 'nowpayments' AND status = 'pending';");

describe.skipIf(!databaseEnabled)("a20 cleanup on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a20-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    expect(rows("SHOW server_version;")).toMatch(/^16\./);
    // Minimal shapes of the production tables the scripts touch.
    sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.users (id uuid PRIMARY KEY, email text, role text);
      CREATE TABLE public.subscriptions (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id), tier text NOT NULL, status text NOT NULL,
        payment_provider text, payment_method text, amount_cents int, currency text DEFAULT 'EUR', crypto_tx_hash text,
        provider_payment_id text, granted_payment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz);
      CREATE TABLE public.processed_webhook_events (provider text, event_id text, payload jsonb, PRIMARY KEY (provider, event_id));
      CREATE TABLE public.admin_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
        actor_email text NOT NULL, action text NOT NULL, target_type text, target_id uuid,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb, ip_address inet, user_agent text, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
      INSERT INTO public.users VALUES ('${ADMIN}', 'admin@medpruf.com', 'admin'), ('${LEARNER}', 'learner@example.invalid', 'user');`);
  });

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  describe("20261206090000 drop admin_exec_select", () => {
    it("drops the runner, is idempotent, and the rollback leaves it unexecutable", () => {
      sql(original);
      sql("REVOKE ALL ON FUNCTION public.admin_exec_select(text) FROM PUBLIC, anon, authenticated, service_role;");
      expect(rows("SELECT to_regprocedure('public.admin_exec_select(text)') IS NOT NULL;")).toBe("t");
      sql(migration);
      expect(rows("SELECT to_regprocedure('public.admin_exec_select(text)') IS NULL;")).toBe("t");
      sql(migration);
      expect(rows("SELECT count(*) FROM pg_proc WHERE proname = 'admin_exec_select';")).toBe("0");
      sql(down);
      expect(rows("SELECT prosecdef FROM pg_proc WHERE proname = 'admin_exec_select';")).toBe("t");
      for (const role of ["service_role", "authenticated", "anon"]) {
        expect(rows(`SELECT has_function_privilege('${role}', 'public.admin_exec_select(text)', 'EXECUTE');`)).toBe("f");
      }
      sql(migration);
      expect(rows("SELECT to_regprocedure('public.admin_exec_select(text)') IS NULL;")).toBe("t");
    });

    it("keeps the admin_rbac legacy-runner guard valid once the function is gone", () => {
      const guard = rbacTest.match(/IF to_regprocedure\('public\.admin_exec_select\(text\)'\)[\s\S]*?END IF;\n  END IF;/);
      expect(guard, "admin_rbac.sql must tolerate a dropped admin_exec_select").not.toBeNull();
      sql(`DO $$ BEGIN ${guard![0]} END $$;`);
    });
  });

  describe("close-pending-nowpayments", () => {
    beforeEach(() => seedSubscriptions());

    it("closes exactly the nine dead rows, saves the before-image and is idempotent", () => {
      expect(pendingNow()).toBe("9");
      sql(close);
      expect(pendingNow()).toBe("0");
      expect(rows(`SELECT count(*) FROM public.subscriptions WHERE id IN (${DEAD.map((d) => `'${d}'`).join(",")}) AND status = 'cancelled' AND cancelled_at IS NOT NULL;`)).toBe("9");
      expect(rows("SELECT count(*) FROM public.subscriptions;")).toBe("12");
      expect(statusOf(MANUAL)).toBe("pending");
      expect(statusOf(WHOP)).toBe("active");
      expect(rows(`SELECT cancelled_at::date FROM public.subscriptions WHERE id = '${OLD_CANCELLED}';`)).toBe("2026-04-21");
      expect(rows("SELECT count(*) || ':' || max(jsonb_array_length(payload->'rows')) || ':' || max(payload->'rows'->0->>'status') FROM public.admin_audit_log WHERE action = 'a20_close_pending_nowpayments';")).toBe("1:9:pending");
      sql(close);
      expect(rows("SELECT count(*) FROM public.admin_audit_log;")).toBe("1");
    });

    it("rollback restores the before-image once and records itself", () => {
      sql(close);
      sql(reopen);
      expect(pendingNow()).toBe("9");
      expect(rows(`SELECT count(*) FROM public.subscriptions WHERE id IN (${DEAD.map((d) => `'${d}'`).join(",")}) AND cancelled_at IS NULL AND updated_at = '2026-05-01T00:00:00Z';`)).toBe("9");
      expect(rows("SELECT count(*) FROM public.admin_audit_log WHERE action = 'a20_close_pending_nowpayments_rollback';")).toBe("1");
      sql(reopen);
      expect(rows("SELECT count(*) FROM public.admin_audit_log WHERE action = 'a20_close_pending_nowpayments_rollback';")).toBe("1");
      // A close after a rollback is allowed again.
      sql(close);
      expect(pendingNow()).toBe("0");
    });

    it("rollback refuses when a closed row changed since", () => {
      sql(close);
      sql(`UPDATE public.subscriptions SET status = 'active' WHERE id = '${DEAD[0]}';`);
      const result = sql(reopen, true);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/changed since the close/);
      expect(statusOf(DEAD[1])).toBe("cancelled");
    });

    it.each([
      ["only eight candidates", `DELETE FROM public.subscriptions WHERE id = '${DEAD[0]}';`, /expected 9/],
      ["a recent candidate", `UPDATE public.subscriptions SET created_at = '2026-06-08T10:00:00Z' WHERE id = '${DEAD[0]}';`, /payment evidence or are too recent/],
      ["a provider payment id", `UPDATE public.subscriptions SET provider_payment_id = '555' WHERE id = '${DEAD[1]}';`, /payment evidence/],
      ["a transaction hash", `UPDATE public.subscriptions SET crypto_tx_hash = '0xabc' WHERE id = '${DEAD[2]}';`, /payment evidence/],
      ["a granted payment", `UPDATE public.subscriptions SET granted_payment_ids = '[{"payment_id":"p"}]' WHERE id = '${DEAD[3]}';`, /payment evidence/],
      ["a webhook claim on the order", `INSERT INTO public.processed_webhook_events VALUES ('nowpayments', '777', '{"order_id":"${DEAD[4]}"}');`, /payment evidence/],
      ["no admin actor", `UPDATE public.users SET role = 'user' WHERE id = '${ADMIN}';`, /audit actor/],
    ])("refuses and writes nothing with %s", (_label, setup, message) => {
      sql(setup);
      const before = rows("SELECT count(*) FROM public.subscriptions WHERE status = 'pending';");
      const result = sql(close, true);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(message);
      expect(rows("SELECT count(*) FROM public.subscriptions WHERE status = 'pending';")).toBe(before);
      expect(rows("SELECT count(*) FROM public.admin_audit_log;")).toBe("0");
      sql(`UPDATE public.users SET role = 'admin' WHERE id = '${ADMIN}';`);
    });
  });
});
