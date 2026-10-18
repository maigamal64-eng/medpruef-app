import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-pricing-v2-gates-1018 proof on a throwaway PostgreSQL 16 cluster
// (npm run test:db:pricing-v2-gates): the staged 20270110090000 trigger makes a
// refund of a 6-month payment cancel its renewal-guard row, so the real
// commit_whop_revoke chain (applied migrations + 20270104 renew-early) no
// longer leaves the refunded buyer Pro to the day after the sitting. Opt-in
// only; never reads a connection URL or production env.
const databaseEnabled = process.env.PRICING_V2_GATES_DATABASE_TESTS === "1";
const PORT = "55481";
let pgBin = "";
function discoverPgBin() {
  if (process.env.PRICING_V2_GATES_PG_BIN) return resolve(process.env.PRICING_V2_GATES_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set PRICING_V2_GATES_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const CHAIN = [
  "supabase/migrations/20261007100000_atomic_whop_paid_grants.sql",
  "supabase/migrations/20261007110000_atomic_whop_revocations.sql",
  "supabase/migrations/20261014110000_whop_revoke_surviving_payment_windows.sql",
  "supabase/migrations/20270104090000_a_renew_early.sql",
].map(read);
const migration = read("scripts/sql/track-a/a-pricing-v2-gates-1018/20270110090000_a_half_year_guard_refund.sql");
const down = read("scripts/sql/track-a/a-pricing-v2-gates-1018/down.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string) {
  const result = binary("psql", ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"], text);
  if (result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
const rows = (text: string) => sql(text).stdout.trim();
const asService = (text: string) => rows(`SET ROLE service_role; ${text}`);
const truthy = (text: string) => expect(rows(`SELECT (${text})::text;`)).toBe("true");
const snapshot = (where: string) => rows(`SELECT jsonb_agg(to_jsonb(s))::text FROM public.subscriptions s WHERE ${where};`);
const revoke = (user: string, claim: string, kind: string, expected: string, candidates: string[]) =>
  JSON.parse(asService(`SELECT row_to_json(r)::text FROM public.commit_whop_revoke('${user}', '${claim}', '${kind}', 'synthetic', '${expected.replace(/'/g, "''")}'::jsonb, ARRAY[${candidates.map((c) => `'${c}'`).join(",")}]::text[], 7) r;`));

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/**
 * A learner whose 6-month membership was guarded: the Whop row ends in 3 days
 * (renewal stopped), the guard row and the users date run 20 days.
 * Extra payments on the Whop row make a refund of one of them partial.
 */
function guarded(opts: { role?: string; extraPayment?: boolean } = {}) {
  const user = uid();
  const mem = `mem_${user.slice(-6)}`;
  const pay = `pay_${user.slice(-6)}`;
  const entries = [`jsonb_build_object('payment_id','${pay}','amount_cents',10000,'added_months',6,'granted_at',now()-interval '177 days')`];
  if (opts.extraPayment) entries.push(`jsonb_build_object('payment_id','${pay}b','amount_cents',10000,'added_months',6,'granted_at',now()-interval '1 day')`);
  sql(`INSERT INTO public.users (id, email, role, tier, tier_expires_at) VALUES ('${user}', '${user}@example.invalid', '${opts.role ?? "user"}', 'pro', date_trunc('second', now()) + interval '20 days');
    INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method, amount_cents, provider_payment_id, granted_payment_ids, whop_membership_id, started_at, expires_at)
      VALUES ('${user}', 'half_year', 'active', 'whop', 'card', 10000, '${pay}', jsonb_build_array(${entries.join(",")}), '${mem}', now() - interval '177 days', now() + interval '3 days');
    INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method, amount_cents, provider_payment_id, started_at, expires_at)
      SELECT '${user}', 'half_year', 'active', 'manual', 'renewal_guard', 0, 'renewal_guard:${mem}:' || to_char(now() + interval '3 days', 'YYYY-MM-DD'), now() + interval '3 days', tier_expires_at
        FROM public.users WHERE id = '${user}';`);
  return { user, mem, pay };
}
const guardStatus = (mem: string) => rows(`SELECT status FROM public.subscriptions WHERE payment_method = 'renewal_guard' AND provider_payment_id LIKE 'renewal_guard:${mem}:%';`);
const owner = (user: string) => rows(`SELECT tier || '|' || coalesce(tier_expires_at::text, 'null') FROM public.users WHERE id = '${user}';`);

describe.skipIf(!databaseEnabled)("a-pricing-v2-gates-1018 staged guard-refund trigger on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "gates1018-pg16-"));
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
      CREATE TABLE public.user_events (id bigserial PRIMARY KEY, user_id uuid, event_type text, event_data jsonb, created_at timestamptz DEFAULT now());`);
    for (const file of CHAIN) sql(file);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("without the trigger (today's chain) a refund after the guard leaves the buyer Pro to the guard's end", () => {
    const g = guarded();
    const before = owner(g.user);
    const out = revoke(g.user, `refund:${g.pay}`, "refunded", snapshot(`whop_membership_id = '${g.mem}'`), [g.pay]);
    expect(out.pro_revoked).toBe(false);
    expect(guardStatus(g.mem)).toBe("active");
    expect(owner(g.user)).toBe(before);
  });

  it("applies twice (idempotent); the function is not executable by anon or authenticated", () => {
    sql(migration);
    sql(migration);
    for (const role of ["anon", "authenticated"]) {
      expect(rows(`SELECT has_function_privilege('${role}', 'public.half_year_guard_follow_refund()', 'EXECUTE')::text;`)).toBe("false");
    }
    expect(rows(`SELECT count(*) FROM pg_trigger WHERE tgname = 'subscriptions_half_year_guard_follow_refund';`)).toBe("1");
  });

  it("a full refund cancels the guard row and the buyer drops to free", () => {
    const g = guarded();
    // commit_whop_revoke read the guard's date as an independent grant and
    // left the user to the trigger, so it reports pro_revoked false.
    revoke(g.user, `refund:${g.pay}`, "refunded", snapshot(`whop_membership_id = '${g.mem}'`), [g.pay]);
    expect(guardStatus(g.mem)).toBe("cancelled");
    truthy(`(SELECT cancelled_at IS NOT NULL FROM public.subscriptions WHERE provider_payment_id LIKE 'renewal_guard:${g.mem}:%')`);
    expect(owner(g.user)).toBe("free|null");
  });

  it("other live coverage survives: the users date moves to that coverage's end", () => {
    const g = guarded();
    sql(`INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method, amount_cents, started_at, expires_at)
      VALUES ('${g.user}', 'pro_manual', 'active', 'manual', 'admin_grant', 0, now(), date_trunc('second', now()) + interval '10 days');`);
    revoke(g.user, `refund:${g.pay}`, "refunded", snapshot(`whop_membership_id = '${g.mem}'`), [g.pay]);
    expect(guardStatus(g.mem)).toBe("cancelled");
    truthy(`(SELECT u.tier = 'pro' AND u.tier_expires_at = s.expires_at FROM public.users u JOIN public.subscriptions s ON s.user_id = u.id AND s.payment_method = 'admin_grant' WHERE u.id = '${g.user}')`);
  });

  it("a partial refund (the row keeps another payment) leaves the guard and the date alone", () => {
    const g = guarded({ extraPayment: true });
    const before = owner(g.user);
    revoke(g.user, `refund:${g.pay}b`, "refunded", snapshot(`whop_membership_id = '${g.mem}'`), [`${g.pay}b`]);
    truthy(`(SELECT status = 'active' FROM public.subscriptions WHERE whop_membership_id = '${g.mem}')`);
    expect(guardStatus(g.mem)).toBe("active");
    expect(owner(g.user)).toBe(before);
  });

  it("a membership cancellation (the period-end deactivation) never touches the guard row", () => {
    const g = guarded();
    const before = owner(g.user);
    revoke(g.user, `cancel:${g.mem}`, "cancelled", snapshot(`whop_membership_id = '${g.mem}'`), []);
    expect(guardStatus(g.mem)).toBe("active");
    expect(owner(g.user)).toBe(before);
  });

  it("a users date that is not the guard's end (a later grant) and admins are left alone; the guard row still ends", () => {
    const later = guarded();
    sql(`UPDATE public.users SET tier_expires_at = tier_expires_at + interval '30 days' WHERE id = '${later.user}';`);
    const laterBefore = owner(later.user);
    revoke(later.user, `refund:${later.pay}`, "refunded", snapshot(`whop_membership_id = '${later.mem}'`), [later.pay]);
    expect(guardStatus(later.mem)).toBe("cancelled");
    expect(owner(later.user)).toBe(laterBefore);

    const admin = guarded({ role: "admin" });
    const adminBefore = owner(admin.user);
    revoke(admin.user, `refund:${admin.pay}`, "refunded", snapshot(`whop_membership_id = '${admin.mem}'`), [admin.pay]);
    expect(owner(admin.user)).toBe(adminBefore);
  });

  it("only the refunded membership's guard is cancelled; a direct status write (TS fallback) fires it too", () => {
    const a = guarded();
    const b = guarded();
    sql(`UPDATE public.subscriptions SET user_id = '${a.user}' WHERE provider_payment_id LIKE 'renewal_guard:${b.mem}:%';`);
    asService(`UPDATE public.subscriptions SET status = 'refunded', cancelled_at = now() WHERE whop_membership_id = '${a.mem}';`);
    expect(guardStatus(a.mem)).toBe("cancelled");
    expect(guardStatus(b.mem)).toBe("active");
  });

  it("down.sql removes the trigger and the function", () => {
    sql(down);
    sql(down);
    expect(rows(`SELECT count(*) FROM pg_trigger WHERE tgname = 'subscriptions_half_year_guard_follow_refund';`)).toBe("0");
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname = 'half_year_guard_follow_refund';`)).toBe("0");
    const g = guarded();
    revoke(g.user, `refund:${g.pay}`, "refunded", snapshot(`whop_membership_id = '${g.mem}'`), [g.pay]);
    expect(guardStatus(g.mem)).toBe("active");
  });
});
