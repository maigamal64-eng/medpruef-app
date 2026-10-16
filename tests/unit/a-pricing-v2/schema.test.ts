import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-pricing-v2 proof on a throwaway PostgreSQL 16 cluster
// (npm run test:db:pricing-v2): 20270103090000 widens the tier CHECK, adds
// the exact-end paid grant, the reverse-trial wall and start function and the
// Guarantee Ticket renewal queue with its decide RPC; it is idempotent,
// service-role only, and down.sql refuses while dependent rows exist.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.PRICING_V2_DATABASE_TESTS === "1";
const PORT = "55471";
let pgBin = "";
function discoverPgBin() {
  if (process.env.PRICING_V2_PG_BIN) return resolve(process.env.PRICING_V2_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set PRICING_V2_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const TIER_CHECK = read("supabase/migrations/20260701120000_subscriptions_allow_notes_pro_trial_tier.sql");
const ATOMIC = read("supabase/migrations/20261007100000_atomic_whop_paid_grants.sql");
const migration = read("supabase/migrations/20270103090000_a_pricing_v2.sql");
const down = read("scripts/sql/track-a/a-pricing-v2/down.sql");

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
const fails = (text: string) => {
  const r = sql(text, true);
  expect(r.status).not.toBe(0);
  return r.stderr;
};

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const NOT_ADMIN = "00000000-0000-4000-8000-0000000000a2";
const BUYER = "00000000-0000-4000-8000-0000000000b1";
const RENEWER = "00000000-0000-4000-8000-0000000000b2";
const NEW1 = "00000000-0000-4000-8000-0000000000c1";
const NEW2 = "00000000-0000-4000-8000-0000000000c2";
const NEW3 = "00000000-0000-4000-8000-0000000000c3";
const NEW4 = "00000000-0000-4000-8000-0000000000c4";
const NEW5 = "00000000-0000-4000-8000-0000000000c5";
const OLD = "00000000-0000-4000-8000-0000000000c6";
const PRO = "00000000-0000-4000-8000-0000000000c7";
const TICKET = "00000000-0000-4000-8000-0000000000d1";
const MONTHLY = "00000000-0000-4000-8000-0000000000d2";
const R1 = "00000000-0000-4000-8000-0000000000e1";
const R2 = "00000000-0000-4000-8000-0000000000e2";
const R3 = "00000000-0000-4000-8000-0000000000e3";
const R4 = "00000000-0000-4000-8000-0000000000e4";
const SINCE = "now() - interval '1 day'";

const startTrial = (user: string, email: string | null, telegram: number | null, ip: string | null, maxPerIp = 3) =>
  JSON.parse(asService(`SELECT public.start_reverse_trial('${user}', ${email ? `'${email}'` : "NULL"}, ${telegram ?? "NULL"}, ${ip ? `'${ip}'` : "NULL"}, 3, ${SINCE}, ${maxPerIp})::text;`));
const decide = (request: string, decision: string, reason: string | null, expected: string, actor = ADMIN) =>
  `SET ROLE service_role; SELECT public.admin_ticket_renewal_decide('${actor}', '${request}', '${decision}', ${reason ? `'${reason}'` : "NULL"}, ${expected}, 2)::text;`;

describe.skipIf(!databaseEnabled)("a-pricing-v2 changeset on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "pv2-pg16-"));
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
        tier_expires_at timestamptz, is_banned boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, tier text NOT NULL, status text NOT NULL,
        payment_provider text, payment_method text, amount_cents int, currency text DEFAULT 'EUR',
        provider_payment_id text, granted_payment_ids jsonb DEFAULT '[]'::jsonb, whop_membership_id text,
        puyp_extensions_used int DEFAULT 0, started_at timestamptz DEFAULT now(), expires_at timestamptz,
        cancelled_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.trials (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, telegram_id bigint,
        user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, started_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT trials_user_id_unique UNIQUE (user_id));
      CREATE UNIQUE INDEX trials_telegram_uniq ON public.trials (telegram_id) WHERE telegram_id IS NOT NULL;
      CREATE TABLE public.admin_audit_log (id bigserial PRIMARY KEY, actor_id uuid, actor_email text, action text,
        target_type text, target_id uuid, payload jsonb, created_at timestamptz DEFAULT now());
      CREATE FUNCTION public.admin_actor_has_permission(p_actor_id uuid, p_permission_key text) RETURNS boolean
        LANGUAGE sql STABLE AS $f$ SELECT p_actor_id = '${ADMIN}'::uuid AND p_permission_key = 'revenue.manage' $f$;
      GRANT EXECUTE ON FUNCTION public.admin_actor_has_permission(uuid, text) TO service_role;
      INSERT INTO public.users (id, email, role, created_at) VALUES
        ('${ADMIN}', 'admin@example.invalid', 'admin', now() - interval '90 days'),
        ('${NOT_ADMIN}', 'na@example.invalid', 'user', now() - interval '90 days'),
        ('${BUYER}', 'buyer@example.invalid', 'user', now() - interval '30 days'),
        ('${RENEWER}', 'renewer@example.invalid', 'user', now() - interval '400 days'),
        ('${NEW1}', 'n1@example.invalid', 'user', now()),
        ('${NEW2}', 'n2@example.invalid', 'user', now()),
        ('${NEW3}', 'n3@example.invalid', 'user', now()),
        ('${NEW4}', 'n4@example.invalid', 'user', now()),
        ('${NEW5}', 'n5@example.invalid', 'user', now()),
        ('${OLD}', 'old@example.invalid', 'user', now() - interval '3 days');
      INSERT INTO public.users (id, email, tier, tier_expires_at, created_at) VALUES
        ('${PRO}', 'pro@example.invalid', 'pro', now() + interval '20 days', now());`);
    sql(TIER_CHECK);
    sql(ATOMIC);
    // OLD was created before the trial switch-on (p_since below is 1 day ago).
    sql(`UPDATE public.users SET created_at = now() - interval '2 days' WHERE id = '${OLD}';`);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("before the changeset a v2 tier is refused by the tier CHECK", () => {
    expect(fails(`INSERT INTO public.subscriptions (user_id, tier, status) VALUES ('${BUYER}', 'sitting_pass', 'active');`)).toMatch(/subscriptions_tier_check/);
  });

  it("applies twice (idempotent) and accepts the five new tiers, old rows untouched", () => {
    sql(`INSERT INTO public.subscriptions (id, user_id, tier, status, payment_provider, started_at, expires_at)
      VALUES ('${MONTHLY}', '${BUYER}', 'first_month_19', 'expired', 'whop', now() - interval '60 days', now() - interval '30 days');`);
    sql(migration);
    sql(migration);
    for (const tier of ["flex_month", "sitting_pass", "half_year", "guarantee_ticket", "reverse_trial"]) {
      sql(`BEGIN; INSERT INTO public.subscriptions (user_id, tier, status) VALUES ('${BUYER}', '${tier}', 'pending'); ROLLBACK;`);
    }
    expect(fails(`INSERT INTO public.subscriptions (user_id, tier, status) VALUES ('${BUYER}', 'lifetime', 'active');`)).toMatch(/subscriptions_tier_check/);
    expect(rows(`SELECT tier || ':' || status FROM public.subscriptions WHERE id = '${MONTHLY}';`)).toBe("first_month_19:expired");
  });

  it("every new function is service_role only", () => {
    for (const fn of [
      "grant_whop_paid_subscription_until(uuid,text,text,integer,text,timestamptz,integer,text)",
      "start_reverse_trial(uuid,text,bigint,text,integer,timestamptz,integer)",
      "admin_ticket_renewal_decide(uuid,uuid,text,text,timestamptz,integer,jsonb)",
    ]) {
      for (const role of ["anon", "authenticated", "public"]) {
        expect(rows(`SELECT has_function_privilege('${role}', 'public.${fn}', 'EXECUTE');`)).toBe("f");
      }
      expect(rows(`SELECT has_function_privilege('service_role', 'public.${fn}', 'EXECUTE');`)).toBe("t");
    }
    for (const role of ["anon", "authenticated"]) {
      expect(rows(`SELECT has_table_privilege('${role}', 'public.ticket_renewal_requests', 'SELECT');`)).toBe("f");
    }
  });

  it("exact-end grant: inserts the pass with its end, replays, never accepts an open or oversized end", () => {
    const g = asService(`SELECT mode || '|' || replayed || '|' || (expires_at = date_trunc('second', now() + interval '40 days'))::text
      FROM public.grant_whop_paid_subscription_until('${BUYER}', 'sitting_pass', 'pay_pass_1', 5900, 'EUR', date_trunc('second', now() + interval '40 days'), 2, 'mem_pass1');`);
    expect(g.split("|").slice(0, 2)).toEqual(["inserted", "false"]);
    expect(rows(`SELECT tier || ':' || status || ':' || (granted_payment_ids->0->>'added_months') || ':' || (granted_payment_ids->0 ? 'ends_at')::text
      FROM public.subscriptions WHERE provider_payment_id = 'pay_pass_1';`)).toBe("sitting_pass:active:2:true");
    expect(rows(`SELECT tier || ':' || (tier_expires_at > now() + interval '39 days' AND tier_expires_at < now() + interval '41 days')::text FROM public.users WHERE id = '${BUYER}';`)).toBe("pro:true");
    const replay = asService(`SELECT mode || '|' || replayed FROM public.grant_whop_paid_subscription_until('${BUYER}', 'sitting_pass', 'pay_pass_1', 5900, 'EUR', now() + interval '50 days', 2, NULL);`);
    expect(replay).toBe("inserted|true");
    for (const bad of ["now() + interval '5 months'", "NULL", "now()"]) {
      expect(sql(`SET ROLE service_role; SELECT * FROM public.grant_whop_paid_subscription_until('${BUYER}', 'sitting_pass', 'pay_bad', 5900, 'EUR', ${bad}, 2, NULL);`, true).status).not.toBe(0);
    }
    expect(sql(`SET ROLE service_role; SELECT * FROM public.grant_whop_paid_subscription_until('${BUYER}', 'sitting_pass', 'pay_bad', 5900, 'EUR', now() + interval '40 days', 0, NULL);`, true).status).not.toBe(0);
  });

  it("exact-end grant on running Whop access adds the pass length after its end", () => {
    const before = rows(`SELECT extract(epoch FROM expires_at)::bigint FROM public.subscriptions WHERE provider_payment_id = 'pay_pass_1';`);
    asService(`SELECT * FROM public.grant_whop_paid_subscription_until('${BUYER}', 'sitting_pass', 'pay_pass_2', 5900, 'EUR', now() + interval '31 days', 2, NULL);`);
    const after = rows(`SELECT extract(epoch FROM expires_at)::bigint FROM public.subscriptions WHERE granted_payment_ids @> '[{"payment_id":"pay_pass_2"}]';`);
    const added = Number(after) - Number(before);
    expect(added).toBeGreaterThan(30 * 86400);
    expect(added).toBeLessThan(32 * 86400);
  });

  it("reverse trial: one start per account, address, Telegram id; network cap; only new verified accounts", () => {
    const first = startTrial(NEW1, "key-a", null, "ip-1");
    expect(first).toMatchObject({ started: true, reason: "started" });
    expect(rows(`SELECT tier || ':' || (tier_expires_at > now() + interval '71 hours' AND tier_expires_at < now() + interval '73 hours')::text FROM public.users WHERE id = '${NEW1}';`)).toBe("pro:true");
    expect(rows(`SELECT tier || ':' || payment_provider || ':' || amount_cents || ':' || (expires_at IS NOT NULL)::text FROM public.subscriptions WHERE user_id = '${NEW1}';`)).toBe("reverse_trial:trial:0:true");
    expect(startTrial(NEW1, "key-a", null, "ip-1")).toMatchObject({ started: false, reason: "used" });
    expect(startTrial(NEW2, "key-a", null, "ip-2")).toMatchObject({ started: false, reason: "email_used" });
    expect(startTrial(NEW2, null, 777, "ip-2")).toMatchObject({ started: true });
    expect(startTrial(NEW3, null, 777, "ip-3")).toMatchObject({ started: false, reason: "telegram_used" });
    expect(startTrial(NEW3, null, null, "ip-3")).toMatchObject({ started: false, reason: "unverified" });
    expect(startTrial(NEW3, "key-c", null, "ip-1", 1)).toMatchObject({ started: false, reason: "ip_limit" });
    expect(startTrial(OLD, "key-old", null, "ip-9")).toMatchObject({ started: false, reason: "before_since" });
    expect(startTrial(PRO, "key-pro", null, "ip-9")).toMatchObject({ started: false, reason: "already_pro" });
    expect(startTrial(ADMIN, "key-admin", null, "ip-9")).toMatchObject({ started: false, reason: "admin" });
    sql(`UPDATE public.users SET created_at = now() - interval '8 days' WHERE id = '${NEW4}';`);
    const tooOld = JSON.parse(asService(`SELECT public.start_reverse_trial('${NEW4}', 'key-4', NULL, 'ip-4', 3, now() - interval '30 days', 3)::text;`));
    expect(tooOld).toMatchObject({ started: false, reason: "too_old" });
    // The wall outlives the account: deleting it keeps the address key used.
    sql(`DELETE FROM public.users WHERE id = '${NEW1}';`);
    expect(startTrial(NEW5, "key-a", null, "ip-5")).toMatchObject({ started: false, reason: "email_used" });
    expect(sql(`SET ROLE service_role; SELECT public.start_reverse_trial('${NEW5}', 'k', NULL, NULL, 30, now(), 3);`, true).status).not.toBe(0);
  });

  it("ticket renewal: compare-and-set, 12 months from the later of end and now, at most two, audited", () => {
    sql(`INSERT INTO public.subscriptions (id, user_id, tier, status, payment_provider, started_at, expires_at)
      VALUES ('${TICKET}', '${RENEWER}', 'guarantee_ticket', 'active', 'whop', now() - interval '340 days', date_trunc('second', now() + interval '25 days'));
      UPDATE public.users SET tier = 'pro', tier_expires_at = date_trunc('second', now() + interval '25 days') WHERE id = '${RENEWER}';
      INSERT INTO public.ticket_renewal_requests (id, user_id, subscription_id, kind, proof_link)
        VALUES ('${R1}', '${RENEWER}', '${TICKET}', 'failed_result', 'https://example.invalid/result');`);
    // One pending request per ticket.
    expect(fails(`INSERT INTO public.ticket_renewal_requests (id, user_id, subscription_id, kind, proof_link)
      VALUES ('${R2}', '${RENEWER}', '${TICKET}', 'failed_result', 'https://example.invalid/again');`)).toMatch(/one_pending/);
    // A booked sitting needs its date; a link must be https; some proof is required.
    expect(fails(`INSERT INTO public.ticket_renewal_requests (id, user_id, subscription_id, kind, proof_link) VALUES (gen_random_uuid(), '${RENEWER}', '${TICKET}', 'booked_sitting', 'https://x.invalid');`)).toMatch(/sitting_check|one_pending/);
    expect(fails(`INSERT INTO public.ticket_renewal_requests (id, user_id, subscription_id, kind, proof_link) VALUES (gen_random_uuid(), '${BUYER}', '${MONTHLY}', 'failed_result', 'http://x.invalid');`)).toMatch(/proof_link_check/);
    const end = rows(`SELECT expires_at FROM public.subscriptions WHERE id = '${TICKET}';`);
    expect(sql(decide(R1, "approve", null, `'${end}'::timestamptz`, NOT_ADMIN), true).stderr).toMatch(/revenue.manage/);
    expect(sql(decide(R1, "approve", null, `'${end}'::timestamptz - interval '1 second'`), true).stderr).toMatch(/changed since you loaded it/);
    expect(sql(decide(R1, "deny", null, `'${end}'::timestamptz`), true).stderr).toMatch(/reason/);
    const ok = JSON.parse(rows(decide(R1, "approve", null, `'${end}'::timestamptz`)));
    expect(ok).toMatchObject({ status: "approved", renewals_used: 1, user_access: "extended" });
    expect(rows(`SELECT (expires_at = '${end}'::timestamptz + interval '12 months')::text FROM public.subscriptions WHERE id = '${TICKET}';`)).toBe("true");
    expect(rows(`SELECT (tier_expires_at = '${end}'::timestamptz + interval '12 months')::text FROM public.users WHERE id = '${RENEWER}';`)).toBe("true");
    expect(sql(decide(R1, "approve", null, `'${end}'::timestamptz`), true).stderr).toMatch(/already been decided/);

    sql(`INSERT INTO public.ticket_renewal_requests (id, user_id, subscription_id, kind, proof_path, sitting_date)
      VALUES ('${R2}', '${RENEWER}', '${TICKET}', 'booked_sitting', '${RENEWER}/r2.pdf', (now() + interval '13 months')::date);`);
    const end2 = rows(`SELECT expires_at FROM public.subscriptions WHERE id = '${TICKET}';`);
    expect(JSON.parse(rows(decide(R2, "approve", "Anmeldebestätigung geprüft", `'${end2}'::timestamptz`)))).toMatchObject({ renewals_used: 2 });
    sql(`INSERT INTO public.ticket_renewal_requests (id, user_id, subscription_id, kind, proof_link)
      VALUES ('${R3}', '${RENEWER}', '${TICKET}', 'failed_result', 'https://example.invalid/third');`);
    const end3 = rows(`SELECT expires_at FROM public.subscriptions WHERE id = '${TICKET}';`);
    expect(sql(decide(R3, "approve", null, `'${end3}'::timestamptz`), true).stderr).toMatch(/cap reached/);
    expect(JSON.parse(rows(decide(R3, "deny", "Höchstzahl erreicht", `'${end3}'::timestamptz`)))).toMatchObject({ status: "denied" });
    expect(rows(`SELECT string_agg(action, ',' ORDER BY id) FROM public.admin_audit_log;`)).toBe("approve_ticket_renewal,approve_ticket_renewal,deny_ticket_renewal");

    // Only a Guarantee Ticket renews this way.
    sql(`INSERT INTO public.ticket_renewal_requests (id, user_id, subscription_id, kind, proof_link)
      VALUES ('${R4}', '${BUYER}', '${MONTHLY}', 'failed_result', 'https://example.invalid/monthly');`);
    const mEnd = rows(`SELECT expires_at FROM public.subscriptions WHERE id = '${MONTHLY}';`);
    expect(sql(decide(R4, "approve", null, `'${mEnd}'::timestamptz`), true).stderr).toMatch(/Only a Guarantee Ticket/);
  });

  it("down refuses while dependent rows exist, then restores the old CHECK, and up applies again", () => {
    expect(sql(down, true).stderr).toMatch(/refusing to roll back/);
    sql(`DELETE FROM public.ticket_renewal_requests; DELETE FROM public.trials WHERE kind = 'reverse';
      DELETE FROM public.subscriptions WHERE tier IN ('flex_month','sitting_pass','half_year','guarantee_ticket','reverse_trial');`);
    sql(down);
    expect(fails(`INSERT INTO public.subscriptions (user_id, tier, status) VALUES ('${BUYER}', 'flex_month', 'active');`)).toMatch(/subscriptions_tier_check/);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname IN ('start_reverse_trial','admin_ticket_renewal_decide','grant_whop_paid_subscription_until');`)).toBe("0");
    expect(rows(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'trials' AND column_name IN ('kind','email_key','ip_hash');`)).toBe("0");
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname IN ('start_reverse_trial','admin_ticket_renewal_decide','grant_whop_paid_subscription_until');`)).toBe("3");
  });
});
