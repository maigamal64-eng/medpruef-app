import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// a-free-credit-hooks proof on a throwaway PostgreSQL 16 cluster
// (npm run test:db:free-credit-hooks): 20270102090000 adds three lot
// sources, their catalogue rows, the campaign code tables and the atomic
// redemption RPC; it is idempotent, service-role only, and down.sql refuses
// while lots of the new sources exist, then restores the old CHECK.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.FREE_CREDIT_DATABASE_TESTS === "1";
const PORT = "55467";
let pgBin = "";
function discoverPgBin() {
  if (process.env.FREE_CREDIT_PG_BIN) return resolve(process.env.FREE_CREDIT_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set FREE_CREDIT_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const BASE = [
  "supabase/migrations/20260428100000_ai_call_log.sql",
  "supabase/migrations/20261014090000_ai_call_log_cache_cols.sql",
  "supabase/migrations/20261014095000_ai_quota_rpc.sql",
  "supabase/migrations/20261022100000_mentor_ledger.sql",
  "supabase/migrations/20261022130000_mentor_beta.sql",
].map(read);
const migration = read("supabase/migrations/20270102090000_a_free_credit_hooks.sql");
const down = read("scripts/sql/track-a/a-free-credit-hooks/down.sql");

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
const redeem = (user: string, code: string, via = "landing", age = 7) =>
  JSON.parse(asService(`SELECT public.mentor_redeem_campaign_code('${user}', '${code}', '${via}', ${age})::text;`));

const U1 = "00000000-0000-4000-8000-0000000000f1";
const U2 = "00000000-0000-4000-8000-0000000000f2";
const U3 = "00000000-0000-4000-8000-0000000000f3";
const OLD = "00000000-0000-4000-8000-0000000000f4";
const BANNED = "00000000-0000-4000-8000-0000000000f5";
const U6 = "00000000-0000-4000-8000-0000000000f6";
const U7 = "00000000-0000-4000-8000-0000000000f7";
const U8 = "00000000-0000-4000-8000-0000000000f8";
const U9 = "00000000-0000-4000-8000-0000000000f9";

describe.skipIf(!databaseEnabled)("a-free-credit-hooks changeset on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "fch-pg16-"));
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
        tier_expires_at timestamptz, is_banned boolean DEFAULT false, created_at timestamptz DEFAULT now(),
        email_verified_at timestamptz DEFAULT now(), telegram_id bigint);
      CREATE TABLE public.answer_history (id bigserial PRIMARY KEY, user_id uuid, question_id integer, created_at timestamptz DEFAULT now());
      CREATE TABLE public.payment_events (id bigserial PRIMARY KEY, event text, provider text DEFAULT 'whop', user_id uuid, tier text, plan_id text, payment_id text, amount_cents int, currency text, reason text, signature_valid boolean, matched boolean, metadata jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE public.flags (key text PRIMARY KEY, enabled boolean, env text, rollout_pct int);
      INSERT INTO public.users (id, email, created_at, is_banned) VALUES
        ('${U1}', 'u1@example.invalid', now() - interval '1 day', false),
        ('${U2}', 'u2@example.invalid', now(), false),
        ('${U3}', 'u3@example.invalid', now(), false),
        ('${OLD}', 'old@example.invalid', now() - interval '8 days', false),
        ('${BANNED}', 'b@example.invalid', now(), true),
        ('${U6}', 'u6@example.invalid', now(), false),
        ('${U7}', 'u7@example.invalid', now(), false);
      INSERT INTO public.users (id, email, created_at, email_verified_at, telegram_id) VALUES
        ('${U8}', 'u8@example.invalid', now(), NULL, NULL),
        ('${U9}', 'u9@example.invalid', now(), NULL, 4242);`);
    for (const m of BASE) sql(m);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("before the changeset the new sources are refused by the CHECK", () => {
    const r = JSON.parse(asService(`SELECT public.mentor_grant_credits('${U1}', 'referral_reward', 'welcome_taste', '${U1}', 125000)::text;`));
    expect(r).toMatchObject({ ok: false, reason: "db_error" });
  });

  it("applies twice (idempotent), adds the sources, rows, tables and index", () => {
    sql(migration);
    sql(migration);
    expect(rows(`SELECT string_agg(package_id || ':' || kind || ':' || grant_micro || ':' || expiry_days, ',' ORDER BY package_id) FROM public.ai_credit_package WHERE package_id IN ('welcome_taste','campaign_code','experience_reward');`))
      .toBe("campaign_code:gift:500000:60,experience_reward:gift:500000:30,welcome_taste:gift:125000:30");
    expect(rows(`SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_ai_credit_lot_source_created';`)).toBe("1");
    for (const [source, key] of [["welcome_taste", U1], ["experience_reward", `testimonial:${U1}`]]) {
      const pkg = source;
      const r = JSON.parse(asService(`SELECT public.mentor_grant_credits('${U1}', '${pkg}', '${source}', '${key}', 125000)::text;`));
      expect(r).toMatchObject({ ok: true, duplicate: false });
      const again = JSON.parse(asService(`SELECT public.mentor_grant_credits('${U1}', '${pkg}', '${source}', '${key}', 125000)::text;`));
      expect(again).toMatchObject({ ok: true, duplicate: true });
    }
    // UNIQUE(source, source_id): another account cannot take the same key.
    const conflict = JSON.parse(asService(`SELECT public.mentor_grant_credits('${U2}', 'welcome_taste', 'welcome_taste', '${U1}', 125000)::text;`));
    expect(conflict).toMatchObject({ ok: false, reason: "source_conflict" });
  });

  it("keeps the new tables and the RPC service-role only", () => {
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`SET ROLE ${role}; SELECT count(*) FROM public.ai_credit_campaign;`, true).status).not.toBe(0);
      expect(sql(`SET ROLE ${role}; SELECT count(*) FROM public.ai_credit_campaign_redemption;`, true).status).not.toBe(0);
      expect(sql(`SET ROLE ${role}; SELECT public.mentor_redeem_campaign_code('${U1}', 'TG-SPT', 'landing', 7);`, true).status).not.toBe(0);
    }
    expect(rows(`SELECT relrowsecurity FROM pg_class WHERE relname IN ('ai_credit_campaign','ai_credit_campaign_redemption') ORDER BY relname;`)).toBe("t\nt");
    // service_role may not rewrite a code's amount after creation.
    expect(sql(`SET ROLE service_role; UPDATE public.ai_credit_campaign SET credits = 999;`, true).status).not.toBe(0);
  });

  it("redeems a live code once per account with every guard", () => {
    sql(`INSERT INTO public.ai_credit_campaign (code, label, credits, expiry_days, total_cap, daily_cap, ends_at) VALUES
      ('TG-SPT', 'Telegram SPT', 100, 60, 3, 2, now() + interval '30 days'),
      ('TG-SIP', 'Telegram SIP', 100, 60, 50, 50, now() + interval '30 days'),
      ('OFF', 'Paused', 100, 60, 50, 50, now() + interval '30 days'),
      ('OVER', 'Ended', 100, 60, 50, 50, now() + interval '30 days'),
      ('LATER', 'Not yet', 100, 60, 50, 50, now() + interval '30 days');
      UPDATE public.ai_credit_campaign SET active = false WHERE code = 'OFF';
      UPDATE public.ai_credit_campaign SET starts_at = now() - interval '10 days', ends_at = now() - interval '1 day' WHERE code = 'OVER';
      UPDATE public.ai_credit_campaign SET starts_at = now() + interval '1 day' WHERE code = 'LATER';`);
    const first = redeem(U1, "TG-SPT");
    expect(first).toMatchObject({ ok: true, duplicate: false, credits: 100, code: "TG-SPT" });
    expect(rows(`SELECT granted_micro || ':' || source || ':' || source_id || ':' || (extract(epoch FROM expires_at - starts_at) / 3600)::int FROM public.ai_credit_lot WHERE source = 'campaign_code' AND user_id = '${U1}';`))
      .toBe(`500000:campaign_code:campaign:${U1}:1440`);
    expect(redeem(U1, "TG-SPT")).toMatchObject({ ok: true, duplicate: true });
    expect(redeem(U1, "TG-SIP")).toMatchObject({ ok: false, reason: "already_redeemed" });
    expect(redeem(OLD, "TG-SIP", "settings")).toMatchObject({ ok: false, reason: "account_too_old" });
    expect(redeem(BANNED, "TG-SIP")).toMatchObject({ ok: false, reason: "banned" });
    expect(redeem(U2, "NOPE")).toMatchObject({ ok: false, reason: "unknown_code" });
    expect(redeem(U2, "OFF")).toMatchObject({ ok: false, reason: "inactive" });
    expect(redeem(U2, "OVER")).toMatchObject({ ok: false, reason: "expired" });
    expect(redeem(U2, "LATER")).toMatchObject({ ok: false, reason: "not_started" });
    expect(redeem(U2, "TG-SPT", "nowhere")).toMatchObject({ ok: false, reason: "invalid_args" });
    // Daily cap 2: U1 counted, U2 fills the day, U3 is refused.
    expect(redeem(U2, "TG-SPT", "settings")).toMatchObject({ ok: true });
    expect(redeem(U3, "TG-SPT")).toMatchObject({ ok: false, reason: "daily_cap" });
    // Total cap 3: move the two redemptions to yesterday, one more fits, then the cap.
    sql(`UPDATE public.ai_credit_campaign_redemption SET redeemed_at = now() - interval '1 day' WHERE code = 'TG-SPT';`);
    expect(redeem(U3, "TG-SPT")).toMatchObject({ ok: true });
    expect(redeem(U6, "TG-SPT")).toMatchObject({ ok: false, reason: "cap_reached" });
    // A refusal writes nothing.
    expect(rows(`SELECT count(*) FROM public.ai_credit_lot WHERE source = 'campaign_code' AND user_id IN ('${U6}', '${OLD}', '${BANNED}');`)).toBe("0");
    expect(rows(`SELECT string_agg(via, ',' ORDER BY id) FROM public.ai_credit_campaign_redemption WHERE code = 'TG-SPT';`)).toBe("landing,settings,landing");
    // Unverified (no email confirmation, no Telegram): needs 10 distinct answered questions; Telegram counts as verified.
    expect(redeem(U8, "NOPE")).toMatchObject({ ok: false, reason: "unverified" });
    sql(`INSERT INTO public.answer_history (user_id, question_id) SELECT '${U8}', g % 9 FROM generate_series(1, 30) g;`);
    expect(redeem(U8, "TG-SIP")).toMatchObject({ ok: false, reason: "unverified" });
    sql(`INSERT INTO public.answer_history (user_id, question_id) VALUES ('${U8}', 100), ('${U8}', 101);`);
    expect(redeem(U8, "TG-SIP")).toMatchObject({ ok: true });
    expect(redeem(U9, "TG-SIP")).toMatchObject({ ok: true });
    // An ineligible account learns nothing about a code: the same answer for a real and a made-up code.
    expect(redeem(OLD, "NOPE", "settings")).toMatchObject({ ok: false, reason: "account_too_old" });
    // A hand-made lot on the key without a redemption row is never funded twice.
    asService(`SELECT public.mentor_grant_credits('${U7}', 'campaign_code', 'campaign_code', 'campaign:${U7}', 5000);`);
    expect(redeem(U7, "TG-SIP")).toMatchObject({ ok: false, reason: "already_redeemed" });
    expect(rows(`SELECT count(*) FROM public.ai_credit_campaign_redemption WHERE user_id = '${U7}';`)).toBe("0");
  });

  it("down.sql refuses while new-source lots exist, then restores the old CHECK and re-applies", () => {
    expect(sql(down, true).status).not.toBe(0);
    expect(rows(`SELECT count(*) FROM public.ai_credit_campaign;`)).toBe("5");
    sql(`DELETE FROM public.ai_usage_ledger WHERE source IN ('welcome_taste','campaign_code','experience_reward');
      DELETE FROM public.ai_credit_lot WHERE source IN ('welcome_taste','campaign_code','experience_reward');`);
    sql(down);
    expect(rows(`SELECT count(*) FROM pg_class WHERE relname IN ('ai_credit_campaign','ai_credit_campaign_redemption');`)).toBe("0");
    expect(rows(`SELECT count(*) FROM public.ai_credit_package WHERE package_id IN ('welcome_taste','campaign_code','experience_reward');`)).toBe("0");
    const refused = JSON.parse(asService(`SELECT public.mentor_grant_credits('${U2}', 'referral_reward', 'welcome_taste', 'x-${U2}', 5000)::text;`));
    expect(refused).toMatchObject({ ok: false, reason: "db_error" });
    sql(migration);
    expect(redeem(U6, "TG-SIP")).toMatchObject({ ok: false, reason: "unknown_code" });
  });
});
