import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearPendingPurchase, markPurchaseGranted, readPurchaseFailure } from "../../../src/lib/mentor/credits/purchases";

// a39 proof on a throwaway PostgreSQL 16 cluster (test:db:a39):
//  20261209090000 adds ai_mentor_purchase.failure_reason (declined, refunded,
//  needs_manual), a later grant clears it, is idempotent, keeps RLS
//  deny-all, and the rollback drops it; purchases.ts then writes status only.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.A39_DATABASE_TESTS === "1";
const PORT = "55451";
let pgBin = "";
function discoverPgBin() {
  if (process.env.A39_PG_BIN) return resolve(process.env.A39_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required for test:db:a39. Set A39_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const MIGRATIONS = [
  "supabase/migrations/20260428100000_ai_call_log.sql",
  "supabase/migrations/20261014090000_ai_call_log_cache_cols.sql",
  "supabase/migrations/20261014095000_ai_quota_rpc.sql",
  "supabase/migrations/20261022100000_mentor_ledger.sql",
].map(read);
const migration = read("supabase/migrations/20261209090000_a39_mentor_purchase_reason.sql");
const down = read("scripts/sql/track-a/a39-mentor-surfaces/down.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();

const lit = (v: unknown) => v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
/** Minimal PostgREST-shaped table client over psql as service_role (update + select maybeSingle). */
function table(name: string) {
  const where: string[] = [];
  let patch: Record<string, unknown> | null = null;
  let cols = "*";
  const q = {
    update(p: Record<string, unknown>) { patch = p; return q; },
    select(c: string) { cols = c; return q; },
    eq(k: string, v: unknown) { where.push(`${k} = ${lit(v)}`); return q; },
    neq(k: string, v: unknown) { where.push(`${k} <> ${lit(v)}`); return q; },
    in(k: string, vs: unknown[]) { where.push(`${k} IN (${vs.map(lit).join(",")})`); return q; },
    async maybeSingle() {
      const r = sql(`SET ROLE service_role; SELECT coalesce((SELECT to_jsonb(t) FROM (SELECT ${cols} FROM public.${name} WHERE ${where.join(" AND ") || "true"} LIMIT 1) t)::text, 'null');`, true);
      if (r.status !== 0) return { data: null, error: { message: r.stderr } };
      return { data: JSON.parse(r.stdout.trim()), error: null };
    },
    then(resolve: (v: { error: unknown }) => void) {
      const set = Object.entries(patch ?? {}).map(([k, v]) => `${k} = ${lit(v)}`).join(", ");
      const r = sql(`SET ROLE service_role; UPDATE public.${name} SET ${set} WHERE ${where.join(" AND ") || "true"};`, true);
      const code = /column "failure_reason".*does not exist/.test(r.stderr) ? "42703" : undefined;
      resolve({ error: r.status === 0 ? null : { code, message: r.stderr } });
    },
  };
  return q;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = { from: table, rpc: async () => ({ data: null, error: null }) } as any;

const U = "00000000-0000-4000-8000-0000000000c1";

describe.skipIf(!databaseEnabled)("a39 purchase failure reason on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "a39-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
      CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, role text DEFAULT 'user', tier text DEFAULT 'free', tier_expires_at timestamptz);
      CREATE TABLE public.payment_events (id bigserial PRIMARY KEY, event text, provider text DEFAULT 'whop', user_id uuid, tier text, plan_id text, payment_id text, amount_cents int, currency text, reason text, signature_valid boolean, matched boolean, metadata jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE public.flags (key text PRIMARY KEY, enabled boolean, env text, rollout_pct int);
      INSERT INTO public.users (id, email) VALUES ('${U}', 'a39@example.invalid');`);
    for (const m of MIGRATIONS) sql(m);
    sql("GRANT SELECT, UPDATE ON public.ai_mentor_purchase TO service_role;");
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  const S1 = "00000000-0000-4000-8000-0000000000e1";
  const S2 = "00000000-0000-4000-8000-0000000000e2";
  const S3 = "00000000-0000-4000-8000-0000000000e3";

  it("before the changeset the app writes status only and reads no reason", async () => {
    sql(`INSERT INTO public.ai_mentor_purchase (checkout_session_id, user_id, package_id) VALUES ('${S1}', '${U}', 'mentor_basis');`);
    await clearPendingPurchase(db, { status: "failed", checkoutSessionId: S1, reason: "declined" });
    expect(rows(`SELECT status FROM public.ai_mentor_purchase WHERE checkout_session_id = '${S1}';`)).toBe("failed");
    expect(await readPurchaseFailure(db, U, S1)).toBeNull();
  });

  it("adds the column idempotently with its check; the app stores and reads the reason; RLS stays deny-all", async () => {
    sql(migration);
    sql(migration);
    sql(`INSERT INTO public.ai_mentor_purchase (checkout_session_id, user_id, package_id) VALUES ('${S2}', '${U}', 'mentor_plus');`);
    await clearPendingPurchase(db, { status: "failed", checkoutSessionId: S2, reason: "needs_manual" });
    expect(rows(`SELECT status || ':' || failure_reason FROM public.ai_mentor_purchase WHERE checkout_session_id = '${S2}';`)).toBe("failed:needs_manual");
    expect(await readPurchaseFailure(db, U, S2)).toBe("needs_manual");
    // Another learner never reads it.
    expect(await readPurchaseFailure(db, "00000000-0000-4000-8000-0000000000c9", S2)).toBeNull();
    // A failed write without a reason leaves it NULL.
    sql(`INSERT INTO public.ai_mentor_purchase (checkout_session_id, user_id, package_id) VALUES ('${S3}', '${U}', 'mentor_topup');`);
    await clearPendingPurchase(db, { status: "failed", checkoutSessionId: S3 });
    expect(await readPurchaseFailure(db, U, S3)).toBeNull();
    // The check refuses unknown reasons.
    expect(sql(`UPDATE public.ai_mentor_purchase SET failure_reason = 'guess' WHERE checkout_session_id = '${S3}';`, true).status).not.toBe(0);
    expect(rows("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_mentor_purchase'::regclass;")).toBe("t");
    for (const role of ["anon", "authenticated"]) expect(rows(`SELECT has_table_privilege('${role}', 'public.ai_mentor_purchase', 'SELECT');`)).toBe("f");
  });

  it("a later grant of a declined purchase succeeds and clears the reason", async () => {
    // S1 was failed before the changeset; mark it declined now, then a second card pays.
    await clearPendingPurchase(db, { status: "failed", checkoutSessionId: S1, reason: "declined" });
    sql(`UPDATE public.ai_mentor_purchase SET failure_reason = 'declined' WHERE checkout_session_id = '${S1}';`);
    expect(await markPurchaseGranted(db, { userId: U, packageId: "mentor_basis", checkoutSessionId: S1, paymentId: "pay_second_card", lotId: null, grantedMicro: 750000 })).toBe("updated");
    expect(rows(`SELECT status || ':' || coalesce(failure_reason, 'null') FROM public.ai_mentor_purchase WHERE checkout_session_id = '${S1}';`)).toBe("granted:null");
    expect(await readPurchaseFailure(db, U, S1)).toBeNull();
  });

  it("the rollback drops the column; the app falls back to status only", async () => {
    sql(down);
    sql(`UPDATE public.ai_mentor_purchase SET status = 'failed' WHERE checkout_session_id = '${S3}';`);
    expect(await markPurchaseGranted(db, { userId: U, packageId: "mentor_topup", checkoutSessionId: S3, paymentId: "pay_s3", lotId: null, grantedMicro: 1 })).toBe("updated");
    expect(rows("SELECT count(*) FROM information_schema.columns WHERE table_name = 'ai_mentor_purchase' AND column_name = 'failure_reason';")).toBe("0");
    expect(await readPurchaseFailure(db, U, S2)).toBeNull();
    sql(migration);
    expect(rows("SELECT count(*) FROM information_schema.columns WHERE table_name = 'ai_mentor_purchase' AND column_name = 'failure_reason';")).toBe("1");
  });
});
