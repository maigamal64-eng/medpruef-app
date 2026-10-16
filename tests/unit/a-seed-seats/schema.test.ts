import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { seatIdentityKey } from "@/lib/seed-seats/server";

// a-seed-seats proof on a throwaway PostgreSQL 16 cluster
// (npm run test:db:seed-seats): 20270105090000 adds the seat code kind, the
// seed_seat tier, the per-person wall and mentor_redeem_seat_code. Abuse and
// replay cases, two concurrent presses, the venue cap under concurrency,
// idempotent apply, service-role only, down.sql refuses while seats exist,
// then restores the credit-code function and the fourteen-tier CHECK.
// Opt-in only; never reads a connection URL or production env.
const databaseEnabled = process.env.SEED_SEATS_DATABASE_TESTS === "1";
const PORT = "55471";
let pgBin = "";
function discoverPgBin() {
  if (process.env.SEED_SEATS_PG_BIN) return resolve(process.env.SEED_SEATS_PG_BIN);
  for (const dir of ["/opt/homebrew/opt/postgresql@16/bin", "/usr/local/opt/postgresql@16/bin", ...(process.env.PATH ?? "").split(":")]) {
    if (["initdb", "pg_ctl", "psql"].every((name) => existsSync(join(dir, name)))) return dir;
  }
  throw new Error("PostgreSQL 16 binaries required. Set SEED_SEATS_PG_BIN or add them to PATH.");
}
const read = (path: string) => readFileSync(resolve(path), "utf8");
const BASE = [
  "supabase/migrations/20260428100000_ai_call_log.sql",
  "supabase/migrations/20261014090000_ai_call_log_cache_cols.sql",
  "supabase/migrations/20261014095000_ai_quota_rpc.sql",
  "supabase/migrations/20261022100000_mentor_ledger.sql",
  "supabase/migrations/20261022130000_mentor_beta.sql",
  "supabase/migrations/20270102090000_a_free_credit_hooks.sql",
].map(read);
const migration = read("supabase/migrations/20270105090000_a_seed_seats.sql");
const down = read("scripts/sql/track-a/a-seed-seats/down.sql");

let cluster = "";
let dataDir = "";
let running = false;
const pgEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))), LC_ALL: "C", LANG: "C" };
const psqlArgs = () => ["-X", "-1", "-h", cluster, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q"];
function binary(name: string, args: string[], input?: string) {
  const result = spawnSync(join(pgBin, name), args, { encoding: "utf8", env: pgEnv, input, timeout: 60_000 });
  if (result.error) throw result.error;
  return result;
}
function sql(text: string, allowFailure = false) {
  const result = binary("psql", psqlArgs(), text);
  if (!allowFailure && result.status !== 0) throw new Error(`Local PostgreSQL proof failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  return result;
}
/** One psql process, not awaited by the next: two of them race for real. */
function sqlAsync(text: string): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn(join(pgBin, "psql"), psqlArgs(), { env: pgEnv });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", rej);
    child.on("close", (code) => (code === 0 ? res(out.trim()) : rej(new Error(err))));
    child.stdin.end(text);
  });
}
const rows = (text: string) => sql(text).stdout.trim();
const asService = (text: string) => rows(`SET ROLE service_role; ${text}`);
const seatSql = (user: string, code: string, age = 14, via = "landing") =>
  `SET ROLE service_role; SELECT public.mentor_redeem_seat_code('${user}', '${code}', '${via}', ${age})::text;`;
const seat = (user: string, code: string, age = 14, via = "landing") => JSON.parse(rows(seatSql(user, code, age, via)));
const credit = (user: string, code: string) =>
  JSON.parse(asService(`SELECT public.mentor_redeem_campaign_code('${user}', '${code}', 'landing', 7)::text;`));

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const NEW1 = id(1), NEW2 = id(2), NEW3 = id(3), OLD = id(4), BANNED = id(5), ADMIN = id(6), PAID = id(7), PAID_EVT = id(8);
const PAID_RCPT = id(9), COMPED = id(10), OPEN = id(11), CARD = id(12), REVERSE = id(13), UNVERIFIED = id(14), TG = id(15);
const TG_TWIN = id(16), MAIL_TWIN = id(17), CREDITED = id(18), RACE = id(19), CAP_A = id(20), CAP_B = id(21), ANSWERS = id(22), DAY14 = id(23);
const STALE = id(24), TWIN_A = id(25), TWIN_B = id(26);

describe.skipIf(!databaseEnabled)("a-seed-seats changeset on isolated PostgreSQL 16", () => {
  beforeAll(() => {
    pgBin = discoverPgBin();
    expect(binary("initdb", ["--version"]).stdout).toMatch(/PostgreSQL\) 16\./);
    cluster = mkdtempSync(join(tmpdir(), "seat-pg16-"));
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
        email_verified_at timestamptz DEFAULT now(), telegram_id bigint, updated_at timestamptz);
      CREATE TABLE public.answer_history (id bigserial PRIMARY KEY, user_id uuid, question_id integer, created_at timestamptz DEFAULT now());
      CREATE TABLE public.payment_events (id bigserial PRIMARY KEY, event text, provider text DEFAULT 'whop', user_id uuid, tier text, plan_id text, payment_id text, amount_cents int, currency text, reason text, signature_valid boolean, matched boolean, metadata jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE public.flags (key text PRIMARY KEY, enabled boolean, env text, rollout_pct int);
      CREATE TABLE public.subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, tier text NOT NULL, status text NOT NULL,
        payment_provider text, payment_method text, amount_cents integer, currency text DEFAULT 'EUR', started_at timestamptz, expires_at timestamptz,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_tier_check CHECK (tier = ANY (ARRAY['premium_pass_guaranteed','monthly','three_month','six_month','twelve_month','first_month_19','first_3mo_27','notes_free_trial','notes_pro_trial','flex_month','sitting_pass','half_year','guarantee_ticket','reverse_trial']));
      CREATE TABLE public.whop_paid_grant_receipts (payment_id text PRIMARY KEY, user_id uuid NOT NULL, subscription_id uuid, grant_mode text, granted_expires_at timestamptz, previous_expires_at timestamptz);
      INSERT INTO public.users (id, email, created_at, role, tier, tier_expires_at, is_banned, email_verified_at, telegram_id) VALUES
        ('${NEW1}', 'n1@example.invalid', now() - interval '2 days', 'user', 'free', NULL, false, now(), NULL),
        ('${NEW2}', 'n2@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${NEW3}', 'n3@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${OLD}', 'old@example.invalid', now() - interval '15 days', 'user', 'free', NULL, false, now(), NULL),
        ('${DAY14}', 'd14@example.invalid', now() - interval '13 days 23 hours', 'user', 'free', NULL, false, now(), NULL),
        ('${BANNED}', 'b@example.invalid', now(), 'user', 'free', NULL, true, now(), NULL),
        ('${ADMIN}', 'a@example.invalid', now(), 'admin', 'admin', NULL, false, now(), NULL),
        ('${PAID}', 'p@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${PAID_EVT}', 'pe@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${PAID_RCPT}', 'pr@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${COMPED}', 'c@example.invalid', now(), 'user', 'pro', now() + interval '20 days', false, now(), NULL),
        ('${OPEN}', 'o@example.invalid', now(), 'user', 'pro', NULL, false, now(), NULL),
        ('${CARD}', 'card@example.invalid', now(), 'user', 'pro', now() + interval '7 days', false, now(), NULL),
        ('${REVERSE}', 'r@example.invalid', now(), 'user', 'pro', now() + interval '3 days', false, now(), NULL),
        ('${UNVERIFIED}', 'uv@example.invalid', now(), 'user', 'free', NULL, false, NULL, NULL),
        ('${ANSWERS}', 'ans@example.invalid', now(), 'user', 'free', NULL, false, NULL, NULL),
        ('${TG}', 'tg@example.invalid', now(), 'user', 'free', NULL, false, NULL, 777),
        ('${TG_TWIN}', 'tg2@example.invalid', now(), 'user', 'free', NULL, false, NULL, 777),
        ('${MAIL_TWIN}', ' N1+other@Example.invalid ', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${STALE}', 'stale@example.invalid', now(), 'user', 'free', now() + interval '200 days', false, now(), NULL),
        ('${TWIN_A}', 'user-27fba946@example.com', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${TWIN_B}', 'user-807ff963@example.com', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${CREDITED}', 'cr@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${RACE}', 'race@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${CAP_A}', 'capa@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL),
        ('${CAP_B}', 'capb@example.invalid', now(), 'user', 'free', NULL, false, now(), NULL);
      INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method, amount_cents, started_at, expires_at) VALUES
        ('${PAID}', 'first_month_19', 'expired', 'whop', 'card', 1900, now() - interval '40 days', now() - interval '10 days'),
        ('${CARD}', 'notes_pro_trial', 'active', 'whop', 'card', 0, now(), now() + interval '7 days'),
        ('${REVERSE}', 'reverse_trial', 'active', 'trial', 'reverse_trial', 0, now(), now() + interval '3 days');
      INSERT INTO public.payment_events (event, user_id, payment_id) VALUES ('grant_succeeded', '${PAID_EVT}', 'pay_x');
      INSERT INTO public.whop_paid_grant_receipts (payment_id, user_id) VALUES ('pay_y', '${PAID_RCPT}');
      INSERT INTO public.answer_history (user_id, question_id) SELECT '${ANSWERS}', g FROM generate_series(1, 30) g;`);
    for (const m of BASE) sql(m);
  }, 120_000);

  afterAll(() => {
    if (running) binary("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"]);
    if (cluster) rmSync(cluster, { recursive: true, force: true });
  });

  it("applies twice (idempotent) and keeps the seat function service-role only", () => {
    sql(migration);
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_constraint WHERE conname IN ('ai_credit_campaign_kind_check','ai_credit_campaign_redemption_identity_check');`)).toBe("2");
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`SET ROLE ${role}; SELECT public.mentor_redeem_seat_code('${NEW1}', 'SEAT-REZ', 'landing', NULL, 14);`, true).status).not.toBe(0);
    }
    // A code's kind and length are fixed at creation.
    expect(sql(`SET ROLE service_role; UPDATE public.ai_credit_campaign SET kind = 'seat';`, true).status).not.toBe(0);
    expect(sql(`SET ROLE service_role; UPDATE public.ai_credit_campaign SET pro_days = 30;`, true).status).not.toBe(0);
  });

  it("refuses seat codes above the venue cap of 20 and inconsistent rows", () => {
    const bad = [
      `('SEAT-BIG', 'x', 'seat', 30, 100, 30, 21, 10, now() + interval '60 days')`,
      `('SEAT-EXP', 'x', 'seat', 30, 100, 60, 20, 10, now() + interval '60 days')`,
      `('SEAT-LONG', 'x', 'seat', 31, 100, 31, 20, 10, now() + interval '60 days')`,
      `('CRED-DAYS', 'x', 'credits', 30, 100, 30, 20, 10, now() + interval '60 days')`,
      `('SEAT-NODAYS', 'x', 'seat', NULL, 100, 30, 20, 10, now() + interval '60 days')`,
    ];
    for (const v of bad) {
      expect(sql(`SET ROLE service_role; INSERT INTO public.ai_credit_campaign (code, label, kind, pro_days, credits, expiry_days, total_cap, daily_cap, ends_at) VALUES ${v};`, true).status).not.toBe(0);
    }
    asService(`INSERT INTO public.ai_credit_campaign (code, label, kind, pro_days, credits, expiry_days, total_cap, daily_cap, ends_at) VALUES
      ('SEAT-REZ', 'Rez/GM group', 'seat', 30, 100, 30, 20, 20, now() + interval '60 days'),
      ('SEAT-TINY', 'Cap test', 'seat', 30, 50, 30, 1, 1, now() + interval '60 days'),
      ('SEAT-DAY', 'Day cap test', 'seat', 30, 50, 30, 20, 1, now() + interval '60 days'),
      ('SEAT-OFF', 'Paused', 'seat', 30, 50, 30, 20, 20, now() + interval '60 days'),
      ('CRED-TG', 'Credits only', 'credits', NULL, 100, 60, 50, 50, now() + interval '60 days');
      UPDATE public.ai_credit_campaign SET active = false WHERE code = 'SEAT-OFF';`);
  });

  it("grants 30 Pro days, the seat row and the credits lot in one go; a replay changes nothing", () => {
    const r = seat(NEW1, "SEAT-REZ");
    expect(r).toMatchObject({ ok: true, duplicate: false, kind: "seat", credits: 100, code: "SEAT-REZ" });
    expect(rows(`SELECT tier || ':' || (extract(epoch FROM tier_expires_at - now()) / 3600)::int FROM public.users WHERE id = '${NEW1}';`)).toBe("pro:720");
    expect(rows(`SELECT tier || ':' || status || ':' || payment_provider || ':' || payment_method || ':' || amount_cents || ':' || (extract(epoch FROM expires_at - started_at) / 3600)::int FROM public.subscriptions WHERE user_id = '${NEW1}';`))
      .toBe("seed_seat:active:seat:seed_seat:0:720");
    // The credits die with the seat.
    expect(rows(`SELECT l.granted_micro || ':' || l.source || ':' || l.source_id || ':' || (l.expires_at = s.expires_at) FROM public.ai_credit_lot l JOIN public.subscriptions s ON s.user_id = l.user_id WHERE l.user_id = '${NEW1}';`))
      .toBe(`500000:campaign_code:campaign:${NEW1}:true`);
    expect(rows(`SELECT (seat_subscription_id IS NOT NULL) || ':' || identity_key || ':' || (seat_ends_at = (SELECT expires_at FROM public.subscriptions WHERE user_id = '${NEW1}')) FROM public.ai_credit_campaign_redemption WHERE user_id = '${NEW1}';`))
      .toBe(`true:${seatIdentityKey("n1@example.invalid")}:true`);
    const again = seat(NEW1, "SEAT-REZ");
    expect(again).toMatchObject({ ok: true, duplicate: true, seat_ends_at: r.seat_ends_at });
    expect(rows(`SELECT count(*) FROM public.subscriptions WHERE user_id = '${NEW1}';`)).toBe("1");
    expect(rows(`SELECT count(*) FROM public.ai_credit_lot WHERE user_id = '${NEW1}';`)).toBe("1");
    // One code per account: another seat code or a credit code is refused.
    expect(seat(NEW1, "SEAT-DAY")).toMatchObject({ ok: false, reason: "already_redeemed" });
    expect(credit(NEW1, "CRED-TG")).toMatchObject({ ok: false, reason: "already_redeemed" });
  });

  it("refuses every account the venue rule excludes, and writes nothing for them", () => {
    expect(seat(OLD, "SEAT-REZ")).toMatchObject({ ok: false, reason: "account_too_old" });
    // A caller cannot widen the 14-day rule.
    expect(seat(OLD, "SEAT-REZ", 365)).toMatchObject({ ok: false, reason: "account_too_old" });
    expect(seat(BANNED, "SEAT-REZ")).toMatchObject({ ok: false, reason: "banned" });
    expect(seat(ADMIN, "SEAT-REZ")).toMatchObject({ ok: false, reason: "already_pro" });
    expect(seat(PAID, "SEAT-REZ")).toMatchObject({ ok: false, reason: "paid_before" });
    expect(seat(PAID_EVT, "SEAT-REZ")).toMatchObject({ ok: false, reason: "paid_before" });
    expect(seat(PAID_RCPT, "SEAT-REZ")).toMatchObject({ ok: false, reason: "paid_before" });
    expect(seat(COMPED, "SEAT-REZ")).toMatchObject({ ok: false, reason: "already_pro" });
    expect(seat(OPEN, "SEAT-REZ")).toMatchObject({ ok: false, reason: "already_pro" });
    expect(seat(CARD, "SEAT-REZ")).toMatchObject({ ok: false, reason: "already_pro" });
    // No verified identity: an address that is not confirmed gives no key.
    expect(seat(UNVERIFIED, "SEAT-REZ")).toMatchObject({ ok: false, reason: "unverified" });
    // Ten answered questions open a credit code, never a seat.
    expect(seat(ANSWERS, "SEAT-REZ")).toMatchObject({ ok: false, reason: "unverified" });
    expect(seat(NEW2, "SEAT-REZ", 14, "nowhere")).toMatchObject({ ok: false, reason: "invalid_args" });
    expect(rows(`SELECT count(*) FROM public.subscriptions WHERE tier = 'seed_seat' AND user_id <> '${NEW1}';`)).toBe("0");
    expect(rows(`SELECT count(*) FROM public.ai_credit_lot WHERE user_id <> '${NEW1}';`)).toBe("0");
    expect(rows(`SELECT tier || ':' || coalesce(tier_expires_at::text, '-') FROM public.users WHERE id = '${OPEN}';`)).toBe("pro:-");
  });

  it("an account 13 days 23 hours old still qualifies; the reverse trial is extended, never shortened", () => {
    expect(seat(DAY14, "SEAT-REZ")).toMatchObject({ ok: true });
    expect(seat(REVERSE, "SEAT-REZ")).toMatchObject({ ok: true });
    expect(rows(`SELECT (extract(epoch FROM tier_expires_at - now()) / 3600)::int FROM public.users WHERE id = '${REVERSE}';`)).toBe("720");
  });

  it("the database key equals the app's mirror (normalised address, own prefix)", () => {
    for (const email of ["n1@example.invalid", " N1+other@Example.invalid ", "user-c7c41ec1@example.com", "user-abc7c021@example.com", "user-1f767115@example.com", "no-at-sign", "@x.at", "x@"]) {
      const db = rows(`SELECT coalesce(public.seed_seat_identity_key('${email}'), 'NULL');`);
      expect(db, email).toBe(seatIdentityKey(email) ?? "NULL");
    }
  });

  it("a stale end on a non-Pro row never stretches the seat past 30 days", () => {
    expect(seat(STALE, "SEAT-REZ")).toMatchObject({ ok: true });
    expect(rows(`SELECT tier || ':' || (extract(epoch FROM tier_expires_at - now()) / 3600)::int FROM public.users WHERE id = '${STALE}';`)).toBe("pro:720");
  });

  it("one seat per person: the same verified address or Telegram on a second account is refused", () => {
    expect(seat(TG, "SEAT-REZ")).toMatchObject({ ok: true });
    expect(seat(TG_TWIN, "SEAT-REZ")).toMatchObject({ ok: false, reason: "identity_used" });
    expect(seat(MAIL_TWIN, "SEAT-REZ")).toMatchObject({ ok: false, reason: "identity_used" });
    // The wall outlives the first account.
    sql(`DELETE FROM public.users WHERE id = '${NEW1}';`);
    expect(seat(MAIL_TWIN, "SEAT-REZ")).toMatchObject({ ok: false, reason: "identity_used" });
  });

  it("keeps seat and credit codes apart", () => {
    expect(credit(CREDITED, "SEAT-REZ")).toMatchObject({ ok: false, reason: "unknown_code" });
    expect(seat(CREDITED, "CRED-TG")).toMatchObject({ ok: false, reason: "unknown_code" });
    // A paused seat code answers exactly like an unknown one, before any account check.
    expect(seat(CREDITED, "SEAT-OFF")).toMatchObject({ ok: false, reason: "unknown_code" });
    expect(seat(OLD, "SEAT-OFF")).toMatchObject({ ok: false, reason: "unknown_code" });
    expect(seat(OLD, "NOPE")).toMatchObject({ ok: false, reason: "unknown_code" });
    expect(seat(CREDITED, "NOPE")).toMatchObject({ ok: false, reason: "unknown_code" });
    expect(credit(CREDITED, "CRED-TG")).toMatchObject({ ok: true, duplicate: false });
    expect(credit(CREDITED, "CRED-TG")).toMatchObject({ ok: true, duplicate: true });
    expect(seat(CREDITED, "SEAT-REZ")).toMatchObject({ ok: false, reason: "already_redeemed" });
  });

  it("the Vienna-day cap and the venue total cap", () => {
    expect(seat(NEW2, "SEAT-DAY")).toMatchObject({ ok: true });
    expect(seat(NEW3, "SEAT-DAY")).toMatchObject({ ok: false, reason: "daily_cap" });
    // Fill SEAT-REZ to 20 with synthetic rows, then the 21st is refused.
    const used = Number(rows(`SELECT count(*) FROM public.ai_credit_campaign_redemption WHERE code = 'SEAT-REZ';`));
    sql(`INSERT INTO public.ai_credit_campaign_redemption (code, user_id, lot_id, credits, via, redeemed_at)
      SELECT 'SEAT-REZ', gen_random_uuid(), gen_random_uuid(), 100, 'landing', now() - interval '2 days' FROM generate_series(1, ${20 - used});`);
    expect(seat(NEW3, "SEAT-REZ")).toMatchObject({ ok: false, reason: "cap_reached" });
  });

  it("two accounts of one address racing: one seat, the other reads identity_used (never an error)", async () => {
    asService(`INSERT INTO public.ai_credit_campaign (code, label, kind, pro_days, credits, expiry_days, total_cap, daily_cap, ends_at) VALUES
      ('SEAT-TWIN', 'Twin race', 'seat', 30, 50, 30, 20, 20, now() + interval '60 days');`);
    const [a, b] = await Promise.all([sqlAsync(seatSql(TWIN_A, "SEAT-TWIN")), sqlAsync(seatSql(TWIN_B, "SEAT-TWIN"))]);
    const both = [JSON.parse(a), JSON.parse(b)];
    expect(both.filter((r) => r.ok === true)).toHaveLength(1);
    expect(both.filter((r) => r.reason === "identity_used")).toHaveLength(1);
    expect(rows(`SELECT count(*) FROM public.subscriptions WHERE user_id IN ('${TWIN_A}', '${TWIN_B}');`)).toBe("1");
    expect(rows(`SELECT count(*) FROM public.ai_credit_lot WHERE user_id IN ('${TWIN_A}', '${TWIN_B}');`)).toBe("1");
  });

  it("two concurrent presses of one account grant one seat; two accounts race for the last place", async () => {
    const [a, b] = await Promise.all([sqlAsync(seatSql(RACE, "SEAT-TINY")), sqlAsync(seatSql(RACE, "SEAT-TINY"))]);
    const results = [JSON.parse(a), JSON.parse(b)];
    expect(results.every((r) => r.ok === true)).toBe(true);
    expect(results.filter((r) => r.duplicate === false)).toHaveLength(1);
    expect(rows(`SELECT count(*) FROM public.subscriptions WHERE user_id = '${RACE}';`)).toBe("1");
    asService(`INSERT INTO public.ai_credit_campaign (code, label, kind, pro_days, credits, expiry_days, total_cap, daily_cap, ends_at) VALUES
      ('SEAT-LAST', 'Last place', 'seat', 30, 50, 30, 1, 1, now() + interval '60 days');`);
    const [x, y] = await Promise.all([sqlAsync(seatSql(CAP_A, "SEAT-LAST")), sqlAsync(seatSql(CAP_B, "SEAT-LAST"))]);
    const both = [JSON.parse(x), JSON.parse(y)];
    expect(both.filter((r) => r.ok === true)).toHaveLength(1);
    expect(both.filter((r) => r.reason === "cap_reached")).toHaveLength(1);
    expect(rows(`SELECT count(*) FROM public.ai_credit_campaign_redemption WHERE code = 'SEAT-LAST';`)).toBe("1");
  });

  it("down.sql refuses while seats exist, then restores the credit-code function and the CHECK, and re-applies", () => {
    expect(sql(down, true).status).not.toBe(0);
    expect(rows(`SELECT count(*) FROM public.subscriptions WHERE tier = 'seed_seat';`)).not.toBe("0");
    sql(`DELETE FROM public.ai_credit_campaign_redemption WHERE code LIKE 'SEAT-%';
      DELETE FROM public.ai_credit_campaign WHERE kind = 'seat';
      UPDATE public.users SET tier = 'free', tier_expires_at = NULL WHERE id IN (SELECT user_id FROM public.subscriptions WHERE tier = 'seed_seat');
      DELETE FROM public.subscriptions WHERE tier = 'seed_seat';`);
    sql(down);
    // Re-runnable.
    sql(down);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname IN ('mentor_redeem_seat_code', 'seed_seat_identity_key');`)).toBe("0");
    expect(rows(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'ai_credit_campaign' AND column_name IN ('kind','pro_days');`)).toBe("0");
    expect(sql(`INSERT INTO public.subscriptions (user_id, tier, status) VALUES ('${NEW2}', 'seed_seat', 'active');`, true).status).not.toBe(0);
    // The restored credit-code function still works.
    expect(credit(CREDITED, "CRED-TG")).toMatchObject({ ok: true, duplicate: true });
    sql(migration);
    expect(rows(`SELECT count(*) FROM pg_proc WHERE proname = 'mentor_redeem_seat_code';`)).toBe("1");
  });
});
