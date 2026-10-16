import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-renew-early proof on a throwaway PostgreSQL 16 cluster
// (npm run test:db:renew-early): grant_whop_paid_subscription_pinned gives a
// new membership its own row starting at the old end, extends a renewal in
// place on its own row, keeps today's rule for legacy shapes; the applied
// commit_whop_revoke then flips only the pinned row on a membership-only
// revoke and pulls a stacked row forward when the older payment is
// refunded; down.sql drops the function and leaves the applied one.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.RENEW_EARLY_DATABASE_TESTS === "1";
const PORT = "55473";
let pgBin = "";
function discoverPgBin() {
  if (process.env.RENEW_EARLY_PG_BIN) return resolve(process.env.RENEW_EARLY_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set RENEW_EARLY_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const ATOMIC = read("supabase/migrations/20261007100000_atomic_whop_paid_grants.sql");
const REVOKE = read("supabase/migrations/20261007110000_atomic_whop_revocations.sql");
const REVOKE_FOLLOW_UP = read("supabase/migrations/20261014110000_whop_revoke_surviving_payment_windows.sql");
const migration = read("supabase/migrations/20270104090000_a_renew_early.sql");
const down = read("scripts/sql/track-a/a-renew-early/down.sql");

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
const asService = (text: string) => rows(`SET ROLE service_role; ${text}`);
const truthy = (text: string) => expect(rows(`SELECT (${text})::text;`)).toBe("true");

const U1 = "00000000-0000-4000-8000-0000000000b1";
const U2 = "00000000-0000-4000-8000-0000000000b2";
const U3 = "00000000-0000-4000-8000-0000000000b3";
const grant = (user: string, payment: string, months: number, membership: string | null, tier = "first_month_19") =>
  asService(`SELECT mode || '|' || replayed FROM public.grant_whop_paid_subscription_pinned('${user}', '${tier}', '${payment}', 1900, 'EUR', ${months}, ${membership ? `'${membership}'` : "NULL"});`);
const snapshot = (where: string) => rows(`SELECT jsonb_agg(to_jsonb(s))::text FROM public.subscriptions s WHERE ${where};`);
const revoke = (user: string, claim: string, kind: string, expected: string, candidates: string[]) =>
  asService(`SELECT row_to_json(r)::text FROM public.commit_whop_revoke('${user}', '${claim}', '${kind}', 'synthetic', '${expected.replace(/'/g, "''")}'::jsonb, ARRAY[${candidates.map((c) => `'${c}'`).join(",")}]::text[], 7) r;`);

describe.skipIf(!databaseEnabled)("a-renew-early changeset on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "renew-pg16-"));
    dataDir = join(cluster, "data");
    const initialized = binary("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"]);
    expect(initialized.status, initialized.stderr).toBe(0);
    const started = binary("pg_ctl", ["-D", dataDir, "-l", join(cluster, "server.log"), "-o", `-k ${cluster} -p ${PORT} -h ''`, "-w", "start"]);
    expect(started.status, started.stderr).toBe(0);
    running = true;
    sql(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
      CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, role text DEFAULT 'user', tier text DEFAULT 'free',
        tier_expires_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, tier text NOT NULL, status text NOT NULL,
        payment_provider text, payment_method text, amount_cents int, currency text DEFAULT 'EUR',
        provider_payment_id text, granted_payment_ids jsonb DEFAULT '[]'::jsonb, whop_membership_id text,
        started_at timestamptz DEFAULT now(), expires_at timestamptz,
        cancelled_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.processed_webhook_events (provider text, event_id text, payload jsonb, processed_at timestamptz DEFAULT now(), PRIMARY KEY (provider, event_id));
      CREATE TABLE public.user_events (id bigserial PRIMARY KEY, user_id uuid, event_type text, event_data jsonb, created_at timestamptz DEFAULT now());
      INSERT INTO public.users (id, email) VALUES ('${U1}', 'u1@example.invalid'), ('${U2}', 'u2@example.invalid'), ('${U3}', 'u3@example.invalid');`);
    sql(ATOMIC);
    sql(REVOKE);
    sql(REVOKE_FOLLOW_UP);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("applies twice (idempotent), service role only", () => {
    sql(migration);
    sql(migration);
    expect(rows(`SELECT has_function_privilege('service_role', 'public.grant_whop_paid_subscription_pinned(uuid,text,text,integer,text,integer,text)', 'EXECUTE')::text;`)).toBe("true");
    for (const role of ["anon", "authenticated"]) {
      expect(rows(`SELECT has_function_privilege('${role}', 'public.grant_whop_paid_subscription_pinned(uuid,text,text,integer,text,integer,text)', 'EXECUTE')::text;`)).toBe("false");
    }
  });

  it("first payment inserts from now; a renewal of the same membership extends that row in place", () => {
    expect(grant(U1, "pay_A1", 1, "mem_A1")).toBe("inserted|false");
    expect(grant(U1, "pay_A2", 1, "mem_A1")).toBe("extended|false");
    truthy(`(SELECT count(*) = 1 FROM public.subscriptions WHERE user_id = '${U1}')`);
    truthy(`(SELECT jsonb_array_length(granted_payment_ids) = 2 AND whop_membership_id = 'mem_A1' FROM public.subscriptions WHERE user_id = '${U1}')`);
  });

  it("a new membership while the pinned row runs gets its own row starting at the old end", () => {
    const oldEnd = rows(`SELECT expires_at FROM public.subscriptions WHERE whop_membership_id = 'mem_A1';`);
    expect(grant(U1, "pay_B1", 6, "mem_B1", "premium_pass_guaranteed")).toBe("inserted|false");
    truthy(`(SELECT started_at = '${oldEnd}'::timestamptz AND whop_membership_id = 'mem_B1' AND tier = 'premium_pass_guaranteed'
      AND expires_at = (date_trunc('month', '${oldEnd}'::timestamptz AT TIME ZONE 'UTC') + interval '6 months'
        + ('${oldEnd}'::timestamptz AT TIME ZONE 'UTC' - date_trunc('month', '${oldEnd}'::timestamptz AT TIME ZONE 'UTC'))) AT TIME ZONE 'UTC'
      FROM public.subscriptions WHERE provider_payment_id = 'pay_B1')`);
    truthy(`(SELECT expires_at = '${oldEnd}'::timestamptz AND whop_membership_id = 'mem_A1' FROM public.subscriptions WHERE whop_membership_id = 'mem_A1')`);
    truthy(`(SELECT u.tier = 'pro' AND u.tier_expires_at = s.expires_at FROM public.users u JOIN public.subscriptions s ON s.user_id = u.id WHERE u.id = '${U1}' AND s.whop_membership_id = 'mem_B1')`);
    truthy(`(SELECT previous_expires_at = '${oldEnd}'::timestamptz AND grant_mode = 'inserted' FROM public.whop_paid_grant_receipts WHERE payment_id = 'pay_B1')`);
    // A replay never writes a second row.
    expect(grant(U1, "pay_B1", 6, "mem_B1", "premium_pass_guaranteed")).toBe("inserted|true");
    truthy(`(SELECT count(*) = 2 FROM public.subscriptions WHERE user_id = '${U1}')`);
  });

  it("a later renewal of the old membership extends its own row, never the stacked one", () => {
    const before = rows(`SELECT expires_at FROM public.subscriptions WHERE whop_membership_id = 'mem_B1';`);
    expect(grant(U1, "pay_A3", 1, "mem_A1")).toBe("extended|false");
    truthy(`(SELECT jsonb_array_length(granted_payment_ids) = 3 FROM public.subscriptions WHERE whop_membership_id = 'mem_A1')`);
    truthy(`(SELECT expires_at = '${before}'::timestamptz AND jsonb_array_length(granted_payment_ids) = 1 FROM public.subscriptions WHERE whop_membership_id = 'mem_B1')`);
  });

  it("legacy shapes keep today's rule: an unpinned live row is extended and takes the pin; no membership id extends the newest", () => {
    sql(`INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method, amount_cents, provider_payment_id, granted_payment_ids, started_at, expires_at)
      VALUES ('${U2}', 'first_3mo_27', 'active', 'whop', 'card', 4900, 'pay_L0',
        jsonb_build_array(jsonb_build_object('payment_id', 'pay_L0', 'amount_cents', 4900, 'added_months', 3, 'granted_at', now() - interval '20 days')),
        now() - interval '20 days', now() + interval '70 days');`);
    expect(grant(U2, "pay_L1", 1, "mem_C1")).toBe("extended|false");
    truthy(`(SELECT count(*) = 1 AND bool_and(whop_membership_id = 'mem_C1') FROM public.subscriptions WHERE user_id = '${U2}')`);
    expect(grant(U2, "pay_L2", 1, null)).toBe("extended|false");
    truthy(`(SELECT count(*) = 1 AND bool_and(jsonb_array_length(granted_payment_ids) = 3) FROM public.subscriptions WHERE user_id = '${U2}')`);
  });

  it("membership-only revoke of the old membership flips only its row; Pro runs to the new row's end", () => {
    const expected = snapshot(`whop_membership_id = 'mem_A1'`);
    const out = JSON.parse(revoke(U1, "cancel:mem_A1", "cancelled", expected, []));
    expect(out.flipped_ids).toHaveLength(1);
    expect(out.pro_revoked).toBe(false);
    truthy(`(SELECT status = 'cancelled' FROM public.subscriptions WHERE whop_membership_id = 'mem_A1')`);
    truthy(`(SELECT status = 'active' FROM public.subscriptions WHERE whop_membership_id = 'mem_B1')`);
    truthy(`(SELECT u.tier = 'pro' AND u.tier_expires_at = s.expires_at FROM public.users u JOIN public.subscriptions s ON s.user_id = u.id WHERE u.id = '${U1}' AND s.whop_membership_id = 'mem_B1')`);
  });

  it("a refund of the older payment pulls the stacked row forward to start from its own grant", () => {
    expect(grant(U3, "pay_X1", 1, "mem_X1")).toBe("inserted|false");
    expect(grant(U3, "pay_Y1", 6, "mem_Y1", "premium_pass_guaranteed")).toBe("inserted|false");
    const storedEnd = rows(`SELECT expires_at FROM public.subscriptions WHERE whop_membership_id = 'mem_Y1';`);
    const expected = snapshot(`user_id = '${U3}'`);
    const out = JSON.parse(revoke(U3, "refund:pay_X1", "refunded", expected, ["pay_X1"]));
    expect(out.pro_revoked).toBe(false);
    truthy(`(SELECT status = 'refunded' FROM public.subscriptions WHERE whop_membership_id = 'mem_X1')`);
    truthy(`(SELECT status = 'active' AND expires_at < '${storedEnd}'::timestamptz
      AND expires_at = (date_trunc('month', ((granted_payment_ids->0->>'granted_at')::timestamptz) AT TIME ZONE 'UTC') + interval '6 months'
        + (((granted_payment_ids->0->>'granted_at')::timestamptz) AT TIME ZONE 'UTC' - date_trunc('month', ((granted_payment_ids->0->>'granted_at')::timestamptz) AT TIME ZONE 'UTC'))) AT TIME ZONE 'UTC'
      FROM public.subscriptions WHERE whop_membership_id = 'mem_Y1')`);
    truthy(`(SELECT u.tier_expires_at = s.expires_at FROM public.users u JOIN public.subscriptions s ON s.user_id = u.id WHERE u.id = '${U3}' AND s.whop_membership_id = 'mem_Y1')`);
  });

  it("membership-only revoke of a stacked row keeps its paid window; a non-stacked row still flips", () => {
    const U4 = "00000000-0000-4000-8000-0000000000b4";
    sql(`INSERT INTO public.users (id, email) VALUES ('${U4}', 'u4@example.invalid');`);
    expect(grant(U4, "pay_P1", 1, "mem_P1")).toBe("inserted|false");
    expect(grant(U4, "pay_Q1", 1, "mem_Q1", "first_month_19")).toBe("inserted|false");
    const storedEnd = rows(`SELECT expires_at FROM public.subscriptions WHERE whop_membership_id = 'mem_Q1';`);
    const out = JSON.parse(revoke(U4, "cancel:mem_Q1", "cancelled", snapshot(`whop_membership_id = 'mem_Q1'`), []));
    expect(out.flipped_ids).toHaveLength(0);
    truthy(`(SELECT status = 'active' AND expires_at = '${storedEnd}'::timestamptz FROM public.subscriptions WHERE whop_membership_id = 'mem_Q1')`);
    truthy(`(SELECT u.tier = 'pro' AND u.tier_expires_at = '${storedEnd}'::timestamptz FROM public.users u WHERE u.id = '${U4}')`);
    // The first (non-stacked) membership still flips on its own deactivation.
    const flip = JSON.parse(revoke(U4, "cancel:mem_P1", "cancelled", snapshot(`whop_membership_id = 'mem_P1'`), []));
    expect(flip.flipped_ids).toHaveLength(1);
    // A refund names a payment and still removes the stacked row.
    const refund = JSON.parse(revoke(U4, "refund:pay_Q1", "refunded", snapshot(`user_id = '${U4}' AND status = 'active'`), ["pay_Q1"]));
    expect(refund.flipped_ids).toHaveLength(1);
    truthy(`(SELECT status = 'refunded' FROM public.subscriptions WHERE whop_membership_id = 'mem_Q1')`);
  });

  it("the existing revoke regression (supabase/tests/whop_revoke_regression.sql) still passes on the replaced commit_whop_revoke", () => {
    // Its own database: the script truncates the ledger tables as service_role,
    // which the grant receipts' foreign key would block (it never grants).
    const created = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", "CREATE DATABASE regress;"]);
    expect(created.status, created.stderr).toBe(0);
    const inRegress = (text: string) => {
      const r = binary("psql", ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "regress", "-v", "ON_ERROR_STOP=1", "-q"], text);
      expect(r.status, r.stderr).toBe(0);
    };
    inRegress(`GRANT USAGE ON SCHEMA public TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;
      CREATE TABLE public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, role text DEFAULT 'user', tier text DEFAULT 'free',
        tier_expires_at timestamptz, first_name text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, tier text NOT NULL, status text NOT NULL,
        payment_provider text, payment_method text, amount_cents int, currency text DEFAULT 'EUR',
        provider_payment_id text, granted_payment_ids jsonb DEFAULT '[]'::jsonb, whop_membership_id text,
        started_at timestamptz DEFAULT now(), expires_at timestamptz,
        cancelled_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.processed_webhook_events (provider text, event_id text, payload jsonb, processed_at timestamptz DEFAULT now(), PRIMARY KEY (provider, event_id));
      CREATE TABLE public.user_events (id bigserial PRIMARY KEY, user_id uuid, event_type text, event_data jsonb, created_at timestamptz DEFAULT now());`);
    inRegress(ATOMIC);
    inRegress(REVOKE);
    inRegress(REVOKE_FOLLOW_UP);
    inRegress(migration);
    inRegress(`DROP TABLE public.whop_paid_grant_receipts CASCADE;`);
    const result = binary("psql", ["-X", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "regress", "-v", "ON_ERROR_STOP=1", "-q", "-f", resolve("supabase/tests/whop_revoke_regression.sql")]);
    expect(result.status, result.stderr.split("\n").filter((l) => /ERROR|FAIL|CONTEXT/.test(l)).join("\n").slice(0, 3000)).toBe(0);
    expect(result.stderr).not.toMatch(/FAIL:/);
    expect(result.stderr).toMatch(/PASS:/);
  });

  it("down.sql drops only the new function and restores commit_whop_revoke", () => {
    sql(down);
    sql(down);
    expect(rows(`SELECT count(*)::text FROM pg_proc WHERE proname = 'grant_whop_paid_subscription_pinned';`)).toBe("0");
    expect(rows(`SELECT count(*)::text FROM pg_proc WHERE proname = 'grant_whop_paid_subscription';`)).toBe("1");
    const restored = rows(`SELECT md5(prosrc) FROM pg_proc WHERE proname = 'commit_whop_revoke';`);
    sql(REVOKE_FOLLOW_UP);
    expect(rows(`SELECT md5(prosrc) FROM pg_proc WHERE proname = 'commit_whop_revoke';`)).toBe(restored);
    sql(migration);
    expect(rows(`SELECT count(*)::text FROM pg_proc WHERE proname = 'grant_whop_paid_subscription_pinned';`)).toBe("1");
  });
});
