/**
 * Kassa replay (a-flip-kassa-replay, sprint 2026-10-16 SP1 gate, Mon 19 Oct).
 *
 * Real Whop bodies (read-only API GETs, redacted: tests/replay/whop/fixtures/
 * real, scripts/whop/kassa-replay-fixtures.py) are wrapped in the v1 Standard
 * Webhooks envelope production receives, signed with a TEST V1 key, and sent
 * through the int-8 webhook route with the flip-set flags. supabase-js runs
 * for real; its PostgREST calls are answered from a throwaway PostgreSQL that
 * carries the production migration set plus 20270102 and 20270103, so the
 * atomic grant/revoke SQL functions production runs are the ones exercised.
 * Whop API reads are answered from the same real fixtures; every other
 * outbound call (mail, Reddit, Telegram) is recorded and never leaves.
 *
 * Opt-in: npm run test:replay:whop (KASSA_REPLAY=1). Results: the JSON file
 * named by KASSA_REPLAY_REPORT, when set.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { LocalCluster } from "./local-pg";
import { PgRest, lit } from "./pgrest";
import { TEST_WHOP_V1_SECRET, whopSignedHeaders } from "../../unit/helpers/whop-signed";

const enabled = process.env.KASSA_REPLAY === "1";
const REPO = resolve(__dirname, "../../..");
const FIX = join(__dirname, "fixtures");
const DAY = 86_400_000;
const PGREST_HOST = "replay-pgrest.invalid";
const LEGACY_SECRET = "legacy-static-secret-for-replay";

const sent = vi.hoisted(() => ({ sentry: [] as Array<{ level: string; message: string }>, mail: [] as Array<{ to: unknown; subject: unknown }> }));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (message: string, level = "info") => { sent.sentry.push({ level: String(level), message: String(message) }); },
  captureException: (err: unknown) => { sent.sentry.push({ level: "exception", message: err instanceof Error ? err.message : String(err) }); },
  withScope: (fn: (s: unknown) => void) => fn({ setTag() {}, setExtra() {}, setLevel() {} }),
  addBreadcrumb: () => {},
}));
// Never a real mail: the replay records what would have gone out.
vi.mock("@/lib/email/zoho", () => ({
  sendZohoEmail: async (args: { to?: unknown; subject?: unknown }) => {
    sent.mail.push({ to: args?.to, subject: args?.subject });
    return { ok: true, messageId: "replay-not-sent" };
  },
}));

type Json = Record<string, unknown>;
const real = (name: string): Json => JSON.parse(readFileSync(join(FIX, "real", `${name}.json`), "utf8"));
const prodCatalog = JSON.parse(readFileSync(join(FIX, "prod-catalog-2026-10-16.json"), "utf8")) as {
  columns: Record<string, string[]>; functions: Record<string, string>;
  constraints: string[]; indexes: string[]; defaults: string[]; triggers: string[];
};
const CATALOG_TABLES = ["subscriptions", "users", "processed_webhook_events", "payment_events", "webhook_attempts", "user_events", "referrals", "admin_audit_log", "trials"];
/** April dump artifacts the shims cannot carry (the stack proof logs the same two). */
const EXPECTED_SKIPPED = ["20260415020000_rls_lockdown.sql", "20260602062251_revoke_anon_exec_on_admin_rpcs.sql"];

// Production plan ids for the live v1 plans (billing-copy.ts, billing-cadence.ts,
// whop/trial). The four v2 plans are created on Mon 19 Oct: track-A reruns
// with their real ids in KASSA_REPLAY_PLAN_<TIER>; until then stand-ins.
const PLANS = {
  first_month_19: "plan_redacted8f2b848b",
  first_3mo_27: "plan_redacted145e2752",
  notes_pro_trial: "plan_redactedec56d4df",
  premium_pass_guaranteed: "plan_redacted324decbc",
  flex_month: process.env.KASSA_REPLAY_PLAN_FLEX_MONTH || "plan_redacted2613d0e6",
  sitting_pass: process.env.KASSA_REPLAY_PLAN_SITTING_PASS || "plan_redacted8608555b",
  half_year: process.env.KASSA_REPLAY_PLAN_HALF_YEAR || "plan_redacted08b8d4b7",
  guarantee_ticket: process.env.KASSA_REPLAY_PLAN_GUARANTEE_TICKET || "plan_redacted0987c28f",
};

/**
 * The whole environment of the run: the runner's shell is cleared to
 * KEEP_ENV first, so no token or switch from the shell reaches the route.
 * Flip set = a-flip-day-runbook flip-config.mjs FLIP_FLAGS (SP1 minimum).
 * Production switches read 16 Oct (vercel env): plain values
 * WHOP_ATOMIC_GRANTS_ENABLED=true, REFERRAL_EXAM_REWARD_ENABLED=true,
 * MENTOR_ENABLED=true; absent in production, so code default here:
 * WHOP_PENDING_REVOKE, WHOP_BUYER_FAIL_CLOSED, WHOP_EXTENSIONS_ENABLED,
 * WHOP_AMOUNT_GUARD (shadow), WHOP_DUNNING_GRACE_DAYS, REDDIT_CAPI_TOKEN.
 * Set in production but encrypted (unread, code default here):
 * TRIAL_REMINDER_EMAILS_ENABLED, MENTOR_PACKAGES_ENABLED,
 * MENTOR_TOPUPS_ENABLED, REFERRAL_EXAM_ACTIVITY_BAR,
 * REFERRAL_EXAM_REWARD_THRESHOLD. Tokens production holds are dummies here
 * (their calls reach the blocked fetch stub).
 */
const KEEP_ENV = /^(PATH|HOME|TMPDIR|TMP|TEMP|USER|LOGNAME|SHELL|LANG|LC_[A-Z]+|TERM|NODE_ENV|NODE_OPTIONS|VITEST.*|KASSA_REPLAY.*|TEST|CI|FORCE_COLOR|NO_COLOR)$/;
const FLIP_ENV: Record<string, string> = {
  PRICING_V2_ENABLED: "true",
  RETURNING_PAYER_PRICES_ENABLED: "true",
  REVERSE_TRIAL_SINCE: new Date(Date.now() - DAY).toISOString(),
  REVERSE_TRIAL_ENABLED: "true",
  REVERSE_TRIAL_IP_SALT: "replay-salt",
  REFERRAL_REQUIRE_CARD_TRIAL: "false",
  EMAIL_CONFIRM_ENABLED: "true",
  REMINDER_LINK_SIGNING_SECRET: "[secret]",
  CODE_AT_SIGNUP_ENABLED: "true",
  FIRST_TOUCH_ENABLED: "true",
  TICKET_RENEWAL_ENABLED: "true",
  TICKET_REMINDER_EMAILS_ENABLED: "true",
  HALF_YEAR_AUTO_STOP_ENABLED: "true",
  HALF_YEAR_REMINDER_EMAILS_ENABLED: "true",
  MENTOR_ACCESS_SCOPE: "signed_in",
  MENTOR_HOUSE_GRANTS_SCOPE: "signed_in",
  MENTOR_WELCOME_ENABLED: "true",
  MENTOR_INCLUDED_RAISE_ENABLED: "true",
  MENTOR_CAMPAIGN_CODES_ENABLED: "true",
  REFERRAL_MENTOR_CREDITS_ENABLED: "true",
  REFERRAL_MENTOR_RAISE_ENABLED: "true",
  WHOP_ATOMIC_GRANTS_ENABLED: "true",
  REFERRAL_EXAM_REWARD_ENABLED: "true",
  MENTOR_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: `http://${PGREST_HOST}`,
  SUPABASE_SERVICE_ROLE_KEY: "replay-service-role",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "replay-anon",
  WHOP_WEBHOOK_SECRET_V1: TEST_WHOP_V1_SECRET,
  WHOP_WEBHOOK_SECRET: LEGACY_SECRET,
  WHOP_API_KEY: "replay-whop-key",
  TELEGRAM_BOT_TOKEN: "replay-telegram-token",
  NEXT_PUBLIC_REDDIT_PIXEL_ID: "replay-pixel",
  PAYMENT_EVENTS_SALT: "replay-payment-salt",
  WHOP_PLAN_FIRST_MONTH_19: PLANS.first_month_19,
  WHOP_PLAN_FIRST_3MO_27: PLANS.first_3mo_27,
  WHOP_PLAN_NOTES_TRIAL: PLANS.notes_pro_trial,
  WHOP_PLAN_PREMIUM_PASS: PLANS.premium_pass_guaranteed,
  WHOP_PLAN_FLEX_MONTH: PLANS.flex_month,
  WHOP_PLAN_SITTING_PASS: PLANS.sitting_pass,
  WHOP_PLAN_HALF_YEAR: PLANS.half_year,
  WHOP_PLAN_GUARANTEE_TICKET: PLANS.guarantee_ticket,
};

// ── the replay world ──────────────────────────────────────────────
let cluster: LocalCluster;
let pg: PgRest;
let POST: (req: NextRequest) => Promise<Response>;
let template = "";
let dbCounter = 0;
const outbound: Array<{ method: string; url: string; status: number }> = [];
/** Whop API objects served for GETs by id (payments and memberships). */
const whopObjects = new Map<string, Json>();
const results: Array<Json> = [];
let savedEnv: NodeJS.ProcessEnv = { ...process.env };

/** Host and path of a blocked call, with any bot token in the path masked. */
function safeUrl(url: URL): string {
  return `${url.host}${url.pathname.replace(/\/bot[^/]+\//, "/bot<masked>/")}`;
}

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.host === PGREST_HOST) return pg.handle(req);
  const method = req.method.toUpperCase();
  if (url.host === "api.whop.com" && method === "GET") {
    const m = /^\/api\/v1\/(payments|memberships)\/([A-Za-z0-9_]+)$/.exec(url.pathname);
    const obj = m ? whopObjects.get(m[2]) : undefined;
    const status = obj ? 200 : 404;
    outbound.push({ method, url: safeUrl(url), status });
    return Promise.resolve(new Response(JSON.stringify(obj ?? { error: { message: "not found in replay fixtures" } }), { status, headers: { "content-type": "application/json", "api-version-date": "2025-01-01" } }));
  }
  // Writes to Whop, mail, ads, Telegram: recorded, never sent.
  outbound.push({ method, url: safeUrl(url), status: 503 });
  return Promise.resolve(new Response(JSON.stringify({ error: "replay: outbound blocked" }), { status: 503 }));
}

function freshDb(label: string): void {
  dbCounter += 1;
  pg.database = cluster.clone(template, `s${dbCounter}_${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`.slice(0, 60));
  sent.sentry.length = 0;
  sent.mail.length = 0;
  outbound.length = 0;
  pg.log.length = 0;
}

function seedUser(id: string, email: string, extra: Partial<{ tier: string; tier_expires_at: string | null; created_days_ago: number }> = {}): void {
  pg.exec(`INSERT INTO public.users (id, email, role, tier, tier_expires_at, created_at, referrals_enabled)
    VALUES (${lit(id)}, ${lit(email)}, 'user', ${lit(extra.tier ?? "free")}, ${extra.tier_expires_at ? lit(extra.tier_expires_at) : "NULL"}, now() - make_interval(days => ${Math.trunc(extra.created_days_ago ?? 30)}), true)`);
}

function seedSub(row: { user_id: string; tier: string; status: string; provider_payment_id: string; whop_membership_id: string | null; amount_cents: number; started_at: string; expires_at: string; granted: Array<Json> }): string {
  const r = pg.returning<{ id: string }>(`INSERT INTO public.subscriptions (user_id, tier, status, payment_provider, payment_method, amount_cents, currency, provider_payment_id, whop_membership_id, started_at, expires_at, granted_payment_ids)
    VALUES (${lit(row.user_id)}, ${lit(row.tier)}, ${lit(row.status)}, 'whop', 'card', ${Math.trunc(row.amount_cents)}, 'EUR', ${lit(row.provider_payment_id)}, ${row.whop_membership_id ? lit(row.whop_membership_id) : "NULL"}, ${lit(row.started_at)}, ${lit(row.expires_at)}, ${lit(JSON.stringify(row.granted))}::jsonb) RETURNING id`);
  return r[0].id;
}

interface DbState {
  subs: Array<{ id: string; user_id: string; tier: string; status: string; provider_payment_id: string | null; whop_membership_id: string | null; amount_cents: number | null; expires_at: string | null; cancelled_at: string | null; granted_payment_ids: Array<Json> }>;
  users: Array<{ id: string; tier: string; tier_expires_at: string | null }>;
  claims: Array<{ event_id: string; payload: Json | null }>;
  events: Array<{ user_id: string; event_type: string }>;
  attempts: Array<{ result: string; signature_valid: boolean | null; error: string | null; event_id: string | null }>;
  pevents: Array<{ event: string; user_id: string | null; payment_id: string | null; matched: boolean | null; metadata: Json | null }>;
}
function state(): DbState {
  return {
    subs: pg.rows(`SELECT id, user_id, tier, status, provider_payment_id, whop_membership_id, amount_cents, expires_at, cancelled_at, granted_payment_ids FROM public.subscriptions ORDER BY created_at, id`),
    users: pg.rows(`SELECT id, tier, tier_expires_at FROM public.users ORDER BY id`),
    claims: pg.rows(`SELECT event_id, payload FROM public.processed_webhook_events WHERE provider = 'whop' ORDER BY processed_at`),
    events: pg.rows(`SELECT user_id, event_type FROM public.user_events ORDER BY id`),
    attempts: pg.rows(`SELECT result, signature_valid, error, event_id FROM public.webhook_attempts ORDER BY received_at`),
    pevents: pg.rows(`SELECT event, user_id, payment_id, matched, metadata FROM public.payment_events ORDER BY id`),
  };
}
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const addMonths = (t: number, n: number) => { const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };

function envelope(type: string, data: Json, msgId = `msg_RP${crypto.randomBytes(9).toString("hex")}`) {
  return { msgId, body: JSON.stringify({ id: msgId, api_version: "v1", api_version_date: null, timestamp: new Date().toISOString(), data, type }) };
}

async function deliver(body: string, headers: Record<string, string>): Promise<{ status: number; json: Json }> {
  const res = await POST(new NextRequest("https://medpruf.com/api/webhooks/whop", { method: "POST", headers, body }));
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { json = { raw: text }; }
  return { status: res.status, json };
}
const signedV1 = (msgId: string, body: string) => whopSignedHeaders(body, { id: msgId });

function record(name: string, fixture: string, expected: string, got: { status: number; json: Json }, after: DbState, pass: boolean, notes: Json = {}) {
  results.push({
    name, fixture, expected, pass,
    response: { status: got.status, body: got.json },
    after: {
      subscriptions: after.subs.map((s) => ({ tier: s.tier, status: s.status, provider_payment_id: s.provider_payment_id, whop_membership_id: s.whop_membership_id, amount_cents: s.amount_cents, expires_at: s.expires_at, payments: s.granted_payment_ids.map((g) => ({ payment_id: g.payment_id, added_months: g.added_months, amount_cents: g.amount_cents })) })),
      users: after.users.map((u) => ({ id: u.id, tier: u.tier, tier_expires_at: u.tier_expires_at })),
      claims: after.claims.map((c) => c.event_id),
      user_events: after.events.map((e) => e.event_type),
      webhook_attempts: after.attempts.map((a) => `${a.result}${a.error ? `: ${a.error}` : ""}`),
      payment_events: after.pevents.map((e) => e.event),
    },
    sentry: [...sent.sentry],
    mail_recorded_not_sent: sent.mail.length,
    outbound: [...outbound],
    ...notes,
  });
}

// Real fixture handles.
const grantMonthly = () => real("payment-grant-monthly");
const grant3mo = () => real("payment-grant-3mo");
const trialStart = () => real("payment-trial-start");
const renewalCycle = () => real("payment-renewal-cycle");
const refundObj = () => real("refund");
const keptCard = () => real("payment-kept-card");
const refundedBank = () => real("payment-refunded-bank-transfer");
const meta = (p: Json) => (p.metadata ?? {}) as Json;
const idOf = (o: unknown) => (o as { id: string }).id;
const emailOf = (p: Json) => (p.user as { email: string }).email;
const HOUR = 3_600_000;
/** 00:00 Europe/Vienna on an ISO day, computed here, not with the code under test. */
function viennaStartOf(isoDay: string): number {
  const utcMidnight = Date.parse(`${isoDay}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Vienna", timeZoneName: "shortOffset" })
    .formatToParts(new Date(utcMidnight)).find((x) => x.type === "timeZoneName")?.value ?? "GMT+1";
  const hours = Number(/GMT([+-]\d+)/.exec(offset)?.[1] ?? "1");
  return utcMidnight - hours * HOUR;
}
const plusDays = (isoDay: string, n: number) => new Date(Date.parse(`${isoDay}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Error-level or exception captures, except the expected "pinned function missing" notice. */
const sentryErrors = () => sent.sentry.filter((x) => (x.level === "error" || x.level === "exception") && !/pinned not installed/.test(x.message));

describe.skipIf(!enabled)("Kassa replay: real Whop payloads through the int-8 flip-set webhook", () => {
  beforeAll(async () => {
    savedEnv = { ...process.env };
    for (const k of Object.keys(process.env)) if (!KEEP_ENV.test(k)) delete process.env[k];
    Object.assign(process.env, FLIP_ENV);
    vi.stubGlobal("fetch", fakeFetch);
    for (const name of ["payment-grant-monthly", "payment-grant-3mo", "payment-trial-start", "payment-renewal-cycle", "payment-kept-card", "payment-refunded-bank-transfer", "membership-renewal", "membership-grant-monthly", "membership-grant-3mo", "membership-refunded"]) {
      const o = real(name);
      whopObjects.set(idOf(o), o);
    }
    cluster = new LocalCluster(REPO);
    cluster.start();
    const dark = cluster.buildTemplate("dark");
    template = cluster.buildTemplate("flip");
    pg = new PgRest(cluster.info.pgBin, cluster.info.socketDir, cluster.info.port, dark);
    ({ POST } = await import("@/app/api/webhooks/whop/route"));
  }, 600_000);

  afterAll(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, savedEnv);
    if (process.env.KASSA_REPLAY_REPORT) {
      writeFileSync(process.env.KASSA_REPLAY_REPORT, JSON.stringify({
        ran_at: new Date().toISOString(),
        schema: { applied: cluster?.info?.applied.length ?? 0, tolerated: cluster?.info?.tolerated ?? [], drift_shims: cluster?.info?.driftShims ?? [] },
        plans: PLANS,
        results,
      }, null, 1));
    }
    cluster?.stop();
  });

  // ── fidelity: the local schema is production's where the webhook touches it ──
  it("the local schema matches production (columns of the money tables, Whop SQL function bodies)", () => {
    const cols = (t: string) => pg.rows<{ c: string }>(`SELECT column_name || ':' || data_type || ':' || is_nullable AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t}' ORDER BY column_name`).map((r) => r.c);
    const mismatched: string[] = [];
    const diffs: Record<string, { local_only: string[]; production_only: string[] }> = {};
    for (const t of CATALOG_TABLES) {
      const local = cols(t);
      const prod = prodCatalog.columns[t];
      if (JSON.stringify(local) !== JSON.stringify(prod)) {
        mismatched.push(t);
        diffs[t] = { local_only: local.filter((c) => !prod.includes(c)), production_only: prod.filter((c) => !local.includes(c)) };
      }
    }
    const fns = pg.rows<{ sig: string; md5: string }>(`SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('grant_whop_paid_subscription', 'commit_whop_revoke', 'repair_whop_user_access', 'mentor_whop_lookup')`);
    const local = Object.fromEntries(fns.map((f) => [f.sig.replace(/^public\./, ""), f.md5]));
    const fnMismatch = Object.keys(prodCatalog.functions).filter((sig) => local[sig] !== prodCatalog.functions[sig]);
    const tableList = CATALOG_TABLES.map((t) => lit(t)).join(", ");
    const listOf = (sqlText: string) => pg.rows<{ x: string }>(sqlText).map((r) => r.x).sort();
    const catalog = {
      constraints: listOf(`SELECT c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) AS x FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relnamespace = 'public'::regnamespace AND r.relname IN (${tableList})`),
      indexes: listOf(`SELECT i.tablename || ' ' || i.indexname || ' ' || regexp_replace(i.indexdef, '^CREATE (UNIQUE )?INDEX \\S+ ON public\\.', '\\1') AS x FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename IN (${tableList})`),
      defaults: listOf(`SELECT c.table_name || '.' || c.column_name || '=' || c.column_default AS x FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name IN (${tableList}) AND c.column_default IS NOT NULL`),
      triggers: listOf(`SELECT tg.tgrelid::regclass::text || ' ' || tg.tgname AS x FROM pg_trigger tg JOIN pg_class r ON r.oid = tg.tgrelid WHERE r.relnamespace = 'public'::regnamespace AND r.relname IN (${tableList}) AND NOT tg.tgisinternal`),
    };
    // Semantics, not names: unique indexes only (a plain index changes no result), sequence names normalised.
    const norm = (k: string, xs: string[]) => {
      if (k === "indexes") return xs.filter((x) => / UNIQUE /.test(x));
      if (k === "defaults") return xs.map((x) => x.replace(/_seq\d+'/, "_seq'"));
      return xs;
    };
    const catalogDiffs: Record<string, { local_only: string[]; production_only: string[] }> = {};
    const plainIndexDiffs = { local_only: catalog.indexes.filter((x) => !/ UNIQUE /.test(x) && !prodCatalog.indexes.includes(x)), production_only: prodCatalog.indexes.filter((x) => !/ UNIQUE /.test(x) && !catalog.indexes.includes(x)) };
    for (const k of ["constraints", "indexes", "defaults", "triggers"] as const) {
      const prod = norm(k, [...prodCatalog[k]]).sort();
      const local = norm(k, catalog[k]).sort();
      const d = { local_only: local.filter((x) => !prod.includes(x)), production_only: prod.filter((x) => !local.includes(x)) };
      if (d.local_only.length || d.production_only.length) catalogDiffs[k] = d;
    }
    const skipped = cluster.info.tolerated.map((t) => t.file.replace(/^[a-z]+:/, ""));
    const skippedOk = [...new Set(skipped)].sort().join(",") === [...EXPECTED_SKIPPED].sort().join(",") && skipped.length === EXPECTED_SKIPPED.length * 2;
    const pass = mismatched.length === 0 && fnMismatch.length === 0 && Object.keys(catalogDiffs).length === 0 && skippedOk;
    const serverVersion = pg.rows<{ v: string }>("SELECT current_setting('server_version') AS v")[0]?.v;
    results.push({ name: "schema fidelity (dark stage = production today)", pass, server_version: serverVersion, mismatched_tables: mismatched, column_diffs: diffs, catalog_diffs: catalogDiffs, plain_index_differences_info: plainIndexDiffs, mismatched_functions: fnMismatch, skipped_migrations: cluster.info.tolerated, drift_shims: cluster.info.driftShims });
    expect(diffs).toEqual({});
    expect(fnMismatch).toEqual([]);
    expect(catalogDiffs).toEqual({});
    expect(skippedOk, JSON.stringify(cluster.info.tolerated)).toBe(true);
  });

  // ── the emulator itself on the real database: single() writes ──
  it("emulator: a single() write commits on exactly one row and rolls back otherwise (PGRST116)", async () => {
    freshDb("emulator_single");
    seedUser("00000000-0000-4000-8000-0000000000e1", "e1@example.invalid");
    seedUser("00000000-0000-4000-8000-0000000000e2", "e2@example.invalid");
    const patch = (filter: string) => pg.handle(new Request(`http://${PGREST_HOST}/rest/v1/users?${filter}`, {
      method: "PATCH", headers: { accept: "application/vnd.pgrst.object+json", prefer: "return=representation", "content-type": "application/json" }, body: JSON.stringify({ tier: "pro" }),
    }));
    const one = await patch("id=eq.00000000-0000-4000-8000-0000000000e1");
    const two = await patch("email=like.*example.invalid");
    const tiers = pg.rows<{ id: string; tier: string }>("SELECT id, tier FROM public.users ORDER BY id");
    const pass = one.status === 200 && two.status === 406 && tiers.map((t) => t.tier).join(",") === "pro,free";
    results.push({ name: "emulator: single() writes", pass, one_row_status: one.status, two_row_status: two.status, tiers_after: tiers.map((t) => t.tier) });
    expect(one.status).toBe(200);
    expect(((await one.json()) as Json).tier).toBe("pro");
    expect(two.status).toBe(406);
    expect(tiers.map((t) => t.tier)).toEqual(["pro", "free"]);
  });

  // ── signature: only the V1 Standard Webhooks HMAC opens the route ──
  describe("signature gate", () => {
    const cases: Array<{ name: string; headers: (msgId: string, body: string) => Record<string, string>; expectError: RegExp }> = [
      { name: "unsigned delivery", headers: () => ({ "content-type": "application/json" }), expectError: /no recognized auth header/ },
      { name: "legacy webhook-secret header only (the configured legacy value)", headers: () => ({ "content-type": "application/json", "webhook-secret": LEGACY_SECRET }), expectError: /legacy webhook-secret header is no longer accepted/ },
      { name: "V1 headers signed with a different key", headers: (id, body) => whopSignedHeaders(body, { id, keyHex: "ab".repeat(32) }), expectError: /verification failed despite/ },
      { name: "V1 signature 10 minutes old (replay window is 5)", headers: (id, body) => whopSignedHeaders(body, { id, timestampSec: Math.floor(Date.now() / 1000) - 600 }), expectError: /verification failed despite/ },
    ];
    for (const c of cases) {
      it(`${c.name}: 401, nothing granted or claimed`, async () => {
        freshDb(c.name);
        const p = grantMonthly();
        seedUser(meta(p).medpruef_user_id as string, emailOf(p));
        const before = state();
        const { msgId, body } = envelope("payment.succeeded", p);
        const got = await deliver(body, c.headers(msgId, body));
        const after = state();
        const pass = got.status === 401 && after.subs.length === 0 && after.claims.length === 0
          && JSON.stringify(after.users) === JSON.stringify(before.users)
          && after.attempts.length === 1 && after.attempts[0].result === "sig_invalid" && c.expectError.test(after.attempts[0].error ?? "");
        record(`auth: ${c.name}`, "payment-grant-monthly (real)", "401; no subscription, user or claim change; one sig_invalid attempt row", got, after, pass);
        expect(got.status).toBe(401);
        expect(after.subs).toEqual([]);
        expect(after.claims).toEqual([]);
        expect(after.users).toEqual(before.users);
        expect(after.attempts.map((a) => a.result)).toEqual(["sig_invalid"]);
        expect(after.attempts[0].error).toMatch(c.expectError);
      });
    }
  });

  // ── the Monday Preview probe, run here against the same route ──
  it("Preview probe script: unsigned 401, configured legacy header 401, V1-signed no-op 200 ignored; nothing granted or claimed", async () => {
    freshDb("probe");
    const { runProbe } = await import("../../../scripts/whop/kassa-replay-probe.mjs");
    const poster = async (_site: string, headers: Record<string, string>, body: string) => {
      const got = await deliver(body, { "content-type": "application/json", ...headers });
      return { status: got.status, json: got.json, text: undefined };
    };
    const report = await runProbe({ site: "https://preview.invalid", bypassEnv: null, legacySecretEnv: "WHOP_WEBHOOK_SECRET", signedNoop: true, v1KeyEnv: "WHOP_WEBHOOK_SECRET_V1", out: null }, poster);
    const after = state();
    const pass = report.pass && after.subs.length === 0 && after.claims.length === 0;
    record("probe: Preview checks in-process", "scripts/whop/kassa-replay-probe.mjs", "unsigned 401; configured legacy value 401; V1-signed payment.created with no payment id 200 ignored; no subscription or claim", { status: 0, json: report as unknown as Json }, after, pass);
    expect(report.checks.map((c: { pass: boolean }) => c.pass)).toEqual([true, true, true]);
    expect(after.subs).toEqual([]);
    expect(after.claims).toEqual([]);
  });

  // ── v1 grants (real bodies), V1 signature only ──
  describe("v1 grants, real payloads, V1 signature only", () => {
    const grants = [
      { name: "monthly 19 EUR (first_month_19)", fixture: "payment-grant-monthly", get: grantMonthly, tier: "first_month_19", months: 1 },
      { name: "3 months 49 EUR (first_3mo_27)", fixture: "payment-grant-3mo", get: grant3mo, tier: "first_3mo_27", months: 3 },
    ];
    for (const g of grants) {
      it(`${g.name}: grants exactly once; a redelivery changes nothing`, async () => {
        freshDb(g.fixture);
        const p = g.get();
        const user = meta(p).medpruef_user_id as string;
        seedUser(user, emailOf(p));
        const { msgId, body } = envelope("payment.succeeded", p);
        const headers = signedV1(msgId, body);
        expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("webhook-secret");
        const t0 = Date.now();
        const got = await deliver(body, headers);
        const after = state();
        const sub = after.subs[0];
        const expectEnd = addMonths(t0, g.months);
        const net = Math.round(Number(p.amount_after_fees) * 100);
        const u = after.users.find((x) => x.id === user)!;
        const redelivered = await deliver(body, signedV1(msgId, body));
        const after2 = state();
        const pass = got.status === 200 && got.json.activated === true && after.subs.length === 1 && sub.tier === g.tier && sub.status === "active"
          && sub.provider_payment_id === p.id && sub.whop_membership_id === idOf(p.membership) && sub.amount_cents === net
          && Math.abs(ms(sub.expires_at) - expectEnd) < HOUR && u.tier === "pro" && ms(u.tier_expires_at) === ms(sub.expires_at)
          && after.claims.some((c) => c.event_id === p.id) && sentryErrors().length === 0
          && redelivered.status === 200 && redelivered.json.duplicate === true && JSON.stringify(after2.subs) === JSON.stringify(after.subs) && JSON.stringify(after2.users) === JSON.stringify(after.users);
        record(`grant v1: ${g.name}`, `${g.fixture} (real)`, `200 activated; one active ${g.tier} row, +${g.months} month(s), net ${net} cents, membership pinned; user pro to the row's end; redelivery = duplicate, no change`, got, after2, pass, { redelivery: { status: redelivered.status, body: redelivered.json } });
        expect(got.status).toBe(200);
        expect(got.json.activated).toBe(true);
        expect(after.subs).toHaveLength(1);
        expect(sub).toMatchObject({ tier: g.tier, status: "active", provider_payment_id: p.id, whop_membership_id: idOf(p.membership), amount_cents: net });
        expect(Math.abs(ms(sub.expires_at) - expectEnd)).toBeLessThan(HOUR);
        expect(u.tier).toBe("pro");
        expect(ms(u.tier_expires_at)).toBe(ms(sub.expires_at));
        expect(sentryErrors()).toEqual([]);
        expect(redelivered.json.duplicate).toBe(true);
        expect(after2.subs).toEqual(after.subs);
        expect(after2.users).toEqual(after.users);
      });
    }
  });

  // ── v2 grants: one per plan, derived from the real monthly body ──
  describe("v2 grants per plan (real body, v2 plan and checkout metadata)", () => {
    const sittingLastDay = new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
    const v2 = [
      { tier: "flex_month", price: 24, months: 1, extraMeta: {} as Json, billing: "subscription_create" },
      { tier: "sitting_pass", price: 59, months: 0, extraMeta: { sitting_bank: "kenntnispruefung", sitting_date: sittingLastDay, sitting_last_day: sittingLastDay } as Json, billing: "one_time" },
      { tier: "half_year", price: 100, months: 6, extraMeta: {} as Json, billing: "subscription_create" },
      { tier: "guarantee_ticket", price: 179, months: 12, extraMeta: {} as Json, billing: "one_time" },
    ];
    const derive = (base: Json, tier: string, price: number, billing: string, extra: Json, metaTier: string | null = tier): Json => {
      const id = `pay_RPv2${tier.replace(/_/g, "").slice(0, 8)}`;
      return {
        ...base,
        id,
        billing_reason: billing,
        plan: { ...(base.plan as Json), id: PLANS[tier as keyof typeof PLANS], metadata: { tier } },
        membership: { ...(base.membership as Json), id: `mem_RPv2${tier.replace(/_/g, "").slice(0, 8)}` },
        total: price, subtotal: price,
        // Whop's fee share on the real 19 EUR charge (17.69 of 19.00).
        amount_after_fees: Math.round(price * (Number(base.amount_after_fees) / Number(base.total)) * 100) / 100,
        metadata: { medpruef_user_id: meta(base).medpruef_user_id, ...(metaTier ? { tier: metaTier } : {}), ...extra },
      };
    };
    const expectedEnd = (tier: string, months: number, t0: number) => (tier === "sitting_pass" ? viennaStartOf(plusDays(sittingLastDay, 2)) : addMonths(t0, months));
    for (const plan of v2) {
      it(`${plan.tier} ${plan.price} EUR: grants the v2 tier with its own duration`, async () => {
        freshDb(`v2_${plan.tier}`);
        const base = grantMonthly();
        const p = derive(base, plan.tier, plan.price, plan.billing, plan.extraMeta);
        const user = meta(p).medpruef_user_id as string;
        seedUser(user, emailOf(p));
        whopObjects.set(idOf(p), p);
        const t0 = Date.now();
        const { msgId, body } = envelope("payment.succeeded", p);
        const got = await deliver(body, signedV1(msgId, body));
        const after = state();
        const sub = after.subs[0];
        const u = after.users.find((x) => x.id === user)!;
        const end = ms(sub?.expires_at);
        // Sitting Pass: access through the day after the sitting (ends 00:00 Vienna two days after its last day).
        const expectEnd = expectedEnd(plan.tier, plan.months, t0);
        const tolerance = plan.tier === "sitting_pass" ? 60_000 : HOUR;
        const net = Math.round(Number(p.amount_after_fees) * 100);
        const pass = got.status === 200 && got.json.activated === true && after.subs.length === 1 && sub.tier === plan.tier && sub.status === "active"
          && sub.provider_payment_id === p.id && sub.whop_membership_id === idOf(p.membership) && sub.amount_cents === net && Math.abs(end - expectEnd) < tolerance
          && u.tier === "pro" && ms(u.tier_expires_at) === end && sentryErrors().length === 0;
        record(`grant v2: ${plan.tier}`, "payment-grant-monthly (real) with the v2 plan id, price and checkout metadata", `200 activated; one active ${plan.tier} row ending ${plan.tier === "sitting_pass" ? "the day after the sitting" : `+${plan.months} months`}; user pro to that end`, got, after, pass, { plan_id: PLANS[plan.tier as keyof typeof PLANS] });
        expect(got.status).toBe(200);
        expect(got.json.activated).toBe(true);
        expect(after.subs).toHaveLength(1);
        expect(sub).toMatchObject({ tier: plan.tier, status: "active", provider_payment_id: p.id, whop_membership_id: idOf(p.membership), amount_cents: net });
        expect(Math.abs(end - expectEnd)).toBeLessThan(tolerance);
        expect(u.tier).toBe("pro");
        expect(ms(u.tier_expires_at)).toBe(end);
        expect(sentryErrors()).toEqual([]);
      });

      it(`${plan.tier}: the plan id alone (no tier in the checkout metadata) maps to the v2 tier`, async () => {
        freshDb(`v2_planonly_${plan.tier}`);
        const p = derive(grantMonthly(), plan.tier, plan.price, plan.billing, plan.extraMeta, null);
        const user = meta(p).medpruef_user_id as string;
        seedUser(user, emailOf(p));
        whopObjects.set(idOf(p), p);
        const t0 = Date.now();
        const { msgId, body } = envelope("payment.succeeded", p);
        const got = await deliver(body, signedV1(msgId, body));
        const after = state();
        const sub = after.subs[0];
        const tolerance = plan.tier === "sitting_pass" ? 60_000 : HOUR;
        const pass = got.status === 200 && after.subs.length === 1 && sub.tier === plan.tier && Math.abs(ms(sub.expires_at) - expectedEnd(plan.tier, plan.months, t0)) < tolerance;
        record(`grant v2 by plan id: ${plan.tier}`, "payment-grant-monthly (real), v2 plan id, metadata without a tier", `200; one ${plan.tier} row from the plan id`, got, after, pass);
        expect(got.status).toBe(200);
        expect(after.subs).toHaveLength(1);
        expect(sub.tier).toBe(plan.tier);
        expect(Math.abs(ms(sub.expires_at) - expectedEnd(plan.tier, plan.months, t0))).toBeLessThan(tolerance);
      });
    }

    it("underpaid: a half_year charge of 24 EUR still grants (guard in shadow on the flip) and raises the amount-mismatch alert", async () => {
      freshDb("v2_underpaid");
      const p = derive(grantMonthly(), "half_year", 24, "subscription_create", {});
      const user = meta(p).medpruef_user_id as string;
      seedUser(user, emailOf(p));
      whopObjects.set(idOf(p), p);
      const { msgId, body } = envelope("payment.succeeded", p);
      const got = await deliver(body, signedV1(msgId, body));
      const after = state();
      const alert = after.events.filter((e) => e.event_type === "whop_payment_amount_mismatch");
      const pass = got.status === 200 && after.subs.length === 1 && alert.length === 1;
      record("amount guard: underpaid half_year", "payment-grant-monthly (real), half_year plan, 24 EUR", "WHOP_AMOUNT_GUARD absent in production = shadow: 200, granted as today, one whop_payment_amount_mismatch alert row (enforce is planned for 1 Nov)", got, after, pass);
      expect(got.status).toBe(200);
      expect(after.subs).toHaveLength(1);
      expect(alert).toHaveLength(1);
    });

    it("metadata disagrees with the plan (half_year metadata on the flex_month plan, 24 EUR): metadata wins by design, the amount alert fires", async () => {
      freshDb("v2_disagree");
      const base = derive(grantMonthly(), "flex_month", 24, "subscription_create", {});
      const p: Json = { ...base, metadata: { ...meta(base), tier: "half_year" } };
      const user = meta(p).medpruef_user_id as string;
      seedUser(user, emailOf(p));
      whopObjects.set(idOf(p), p);
      const { msgId, body } = envelope("payment.succeeded", p);
      const got = await deliver(body, signedV1(msgId, body));
      const after = state();
      const alert = after.events.filter((e) => e.event_type === "whop_payment_amount_mismatch");
      const pass = got.status === 200 && after.subs.length === 1 && after.subs[0].tier === "half_year" && alert.length === 1;
      record("plan vs metadata disagreement", "payment-grant-monthly (real), flex_month plan id, half_year checkout metadata", "metadata.tier is primary (route.ts: our server sets it at checkout; buyers cannot edit it): half_year granted, and the shadow amount guard records the 24 vs 100 EUR mismatch", got, after, pass);
      expect(got.status).toBe(200);
      expect(after.subs[0]?.tier).toBe("half_year");
      expect(alert).toHaveLength(1);
    });

    it("flex_month renewal (real subscription_cycle body, metadata null): extends the same row by one month", async () => {
      freshDb("v2_flex_renewal");
      const first = derive(grantMonthly(), "flex_month", 24, "subscription_create", {});
      const user = meta(first).medpruef_user_id as string;
      seedUser(user, emailOf(first));
      whopObjects.set(idOf(first), first);
      const e1 = envelope("payment.succeeded", first);
      await deliver(e1.body, signedV1(e1.msgId, e1.body));
      const mid = state();
      const cycle = renewalCycle();
      const renewal: Json = { ...cycle, id: "pay_redactedc8d0c299", plan: { ...(cycle.plan as Json), id: PLANS.flex_month, metadata: { tier: "flex_month" } }, membership: { ...(cycle.membership as Json), id: idOf(first.membership) }, total: 24, subtotal: 24, amount_after_fees: 22.34, metadata: null, user: first.user };
      whopObjects.set(idOf(renewal), renewal);
      const e2 = envelope("payment.succeeded", renewal);
      const got = await deliver(e2.body, signedV1(e2.msgId, e2.body));
      const after = state();
      const sub = after.subs[0];
      const prevEnd = ms(mid.subs[0]?.expires_at);
      const pass = got.status === 200 && after.subs.length === 1 && Math.abs(ms(sub.expires_at) - addMonths(prevEnd, 1)) < HOUR
        && sub.granted_payment_ids.length === 2 && after.users.find((x) => x.id === user)!.tier === "pro";
      record("renewal v2: flex_month cycle", "payment-renewal-cycle (real) re-pointed at the flex_month plan and membership", "200; same row, +1 month from its previous end, both payments recorded, still pro", got, after, pass);
      expect(got.status).toBe(200);
      expect(after.subs).toHaveLength(1);
      expect(Math.abs(ms(sub.expires_at) - addMonths(prevEnd, 1))).toBeLessThan(HOUR);
      expect(sub.granted_payment_ids.map((g) => g.payment_id)).toEqual([first.id, renewal.id]);
    });
  });

  // ── renewal of a v1 monthly plan: metadata null, so the tier comes only from WHOP_PLAN_FIRST_MONTH_19 ──
  it("monthly renewal (real cycle body on the monthly plan, metadata null): same row +1 month, tier from the plan id env", async () => {
    freshDb("v1_monthly_renewal");
    const first = grantMonthly();
    const user = meta(first).medpruef_user_id as string;
    seedUser(user, emailOf(first));
    const e1 = envelope("payment.succeeded", first);
    await deliver(e1.body, signedV1(e1.msgId, e1.body));
    const mid = state();
    const cycle = renewalCycle();
    const renewal: Json = { ...cycle, id: "pay_redacted4ec8ead2", plan: { ...(first.plan as Json) }, membership: { ...(cycle.membership as Json), id: idOf(first.membership) }, metadata: null, user: first.user };
    whopObjects.set(idOf(renewal), renewal);
    const e2 = envelope("payment.succeeded", renewal);
    const got = await deliver(e2.body, signedV1(e2.msgId, e2.body));
    const after = state();
    const sub = after.subs[0];
    const prevEnd = ms(mid.subs[0]?.expires_at);
    const pass = got.status === 200 && got.json.activated === true && after.subs.length === 1 && sub.tier === "first_month_19"
      && Math.abs(ms(sub.expires_at) - addMonths(prevEnd, 1)) < HOUR && sub.granted_payment_ids.length === 2 && sentryErrors().length === 0;
    record("renewal v1: first_month_19 cycle", "payment-renewal-cycle (real) on the monthly plan plan_redacted8f2b848b and the monthly grant's membership", "200; same row +1 month. Depends on production WHOP_PLAN_FIRST_MONTH_19 = plan_redacted8f2b848b: with any other value this cycle is 'unmapped, manual grant' (release.md step 2)", got, after, pass, { plan_id: PLANS.first_month_19 });
    expect(got.status).toBe(200);
    expect(got.json.activated).toBe(true);
    expect(after.subs).toHaveLength(1);
    expect(sub.tier).toBe("first_month_19");
    expect(Math.abs(ms(sub.expires_at) - addMonths(prevEnd, 1))).toBeLessThan(HOUR);
    expect(sub.granted_payment_ids.map((g) => g.payment_id)).toEqual([first.id, renewal.id]);
  });

  // ── a-pricing-v2-gates-1018 gate D-A: an old-plan purchase with no tie to our checkout (public plan link) ──
  describe("old 19 EUR plan bought outside our checkout after the flip (metadata null, new membership, no checkout id)", () => {
    const publicLinkBody = (): Json => {
      const p = grantMonthly();
      const mem = "mem_redacted5b48d8ac";
      whopObjects.set(mem, { id: mem, status: "active", metadata: null, plan: { id: PLANS.first_month_19 } });
      return { ...p, id: "pay_redacted3cacfb80", metadata: null, checkout_configuration_id: null, membership: { id: mem, status: "active" } };
    };
    // payment_events inserts fail in this emulator (service_role has no grant
    // on its sequence), so the route's own user_events and webhook_attempts
    // rows carry the evidence: resolved_via on the activation, the unmapped
    // delivery with its tier.
    const activation = (user: string) =>
      (pg.rows(`SELECT event_data FROM public.user_events WHERE user_id = '${user}' AND event_type = 'whop_subscription_activated' ORDER BY id`) as Array<{ event_data: Json }>)[0]?.event_data;

    it("an account with the payer's email and no earlier payment: granted first_month_19 by email match (the D-A leak the hidden plans close)", async () => {
      freshDb("gates_public_link_email");
      const body = publicLinkBody();
      const user = "00000000-0000-4000-8000-00000000d0a1";
      seedUser(user, emailOf(body));
      const e = envelope("payment.succeeded", body);
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      const granted = activation(user);
      const pass = got.status === 200 && got.json.activated === true && got.json.mode === "inserted" && after.subs.length === 1 && after.subs[0].tier === "first_month_19"
        && after.subs[0].whop_membership_id === "mem_redacted5b48d8ac" && granted?.resolved_via === "email";
      record("gate D-A: public-link old plan, email match", "payment-grant-monthly (real) with metadata, checkout id and membership tie removed", "200 activated first_month_19 for the email-matched account, resolved_via email, mode inserted: v1 price outside the returning-payer rule", got, after, pass, { activation: granted ?? null });
      expect(got.status).toBe(200);
      expect(got.json.activated).toBe(true);
      expect(after.subs).toHaveLength(1);
      expect(after.subs[0]).toMatchObject({ tier: "first_month_19", user_id: user, whop_membership_id: "mem_redacted5b48d8ac" });
      expect(got.json.mode).toBe("inserted");
      expect(granted).toMatchObject({ resolved_via: "email", tier: "first_month_19", membership_id: "mem_redacted5b48d8ac" });
    });

    it("no account with the payer's email: nothing granted, recorded as unmapped with the old plan id (Unresolved payments)", async () => {
      freshDb("gates_public_link_unmapped");
      const body = publicLinkBody();
      seedUser("00000000-0000-4000-8000-00000000d0a2", "someone-else@example.invalid");
      const e = envelope("payment.succeeded", body);
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      const attempt = after.attempts.find((a) => a.event_id === idOf(body));
      const claim = after.claims.find((c) => c.event_id === idOf(body));
      const pass = got.status === 200 && got.json.ok === false && after.subs.length === 0 && attempt?.result === "user_not_found"
        && /tier=first_month_19/.test(String(attempt?.error)) && (claim?.payload as Json | undefined)?.outcome === "unmapped";
      record("gate D-A: public-link old plan, no account", "payment-grant-monthly (real) with every tie removed and an unknown email", "200 ok:false; no row; delivery user_not_found with tier first_month_19; claim kept with outcome unmapped (Unresolved payments)", got, after, pass);
      expect(got.status).toBe(200);
      expect(got.json.ok).toBe(false);
      expect(after.subs).toHaveLength(0);
      expect(attempt?.result).toBe("user_not_found");
      expect(String(attempt?.error)).toMatch(/user=none tier=first_month_19/);
      expect((claim?.payload as Json | undefined)?.outcome).toBe("unmapped");
    });
  });

  // ── renewal: the real trial start then the real 19 EUR cycle charge ──
  it("renewal (real): EUR 0 trial start grants the trial window, the 19 EUR cycle charge (metadata null) extends the same row by one month", async () => {
    freshDb("renewal_real");
    const start = trialStart();
    const cycle = renewalCycle();
    const user = meta(start).medpruef_user_id as string;
    seedUser(user, emailOf(cycle));
    const e1 = envelope("payment.succeeded", start);
    const t0 = Date.now();
    const r1 = await deliver(e1.body, signedV1(e1.msgId, e1.body));
    const mid = state();
    const trialEnd = ms(mid.subs[0]?.expires_at);
    const e2 = envelope("payment.succeeded", cycle);
    const got = await deliver(e2.body, signedV1(e2.msgId, e2.body));
    const after = state();
    const sub = after.subs[0];
    const u = after.users.find((x) => x.id === user)!;
    const net = Math.round(Number(cycle.amount_after_fees) * 100);
    const pass = r1.status === 200 && mid.subs.length === 1 && mid.subs[0].tier === "notes_pro_trial" && Math.abs(trialEnd - (t0 + 8 * DAY)) < HOUR
      && got.status === 200 && after.subs.length === 1 && sub.id === mid.subs[0].id && Math.abs(ms(sub.expires_at) - addMonths(trialEnd, 1)) < HOUR
      && sub.granted_payment_ids.some((g) => g.payment_id === cycle.id && g.added_months === 1 && g.amount_cents === net) && u.tier === "pro" && ms(u.tier_expires_at) === ms(sub.expires_at);
    record("renewal: trial start then cycle charge", "payment-trial-start + payment-renewal-cycle (real)", "start: one notes_pro_trial row, about 8 days; cycle (metadata null, resolved by the membership pin): same row +1 month from the trial end, payment recorded with 1 month and its net amount; user pro to the new end", got, after, pass, { trial_start: { status: r1.status, body: r1.json, expires_at: mid.subs[0]?.expires_at } });
    expect(r1.status).toBe(200);
    expect(mid.subs).toHaveLength(1);
    expect(mid.subs[0].tier).toBe("notes_pro_trial");
    expect(Math.abs(trialEnd - (t0 + 8 * DAY))).toBeLessThan(HOUR);
    expect(got.status).toBe(200);
    expect(after.subs).toHaveLength(1);
    expect(sub.id).toBe(mid.subs[0].id);
    expect(Math.abs(ms(sub.expires_at) - addMonths(trialEnd, 1))).toBeLessThan(HOUR);
    expect(sentryErrors()).toEqual([]);
    expect(sub.granted_payment_ids.find((g) => g.payment_id === cycle.id)).toMatchObject({ added_months: 1, amount_cents: net });
    expect(u.tier).toBe("pro");
    expect(ms(u.tier_expires_at)).toBe(ms(sub.expires_at));
  });

  // ── refund: the one real Whop refund (rf_, 10 Oct, bank-transfer double payment) ──
  describe("refund (real refund.created body)", () => {
    const user = () => meta(keptCard()).medpruef_user_id as string;
    const bankPay = () => idOf(refundedBank());
    const cardPay = () => idOf(keptCard());
    const iso = (t: number) => new Date(t).toISOString();

    it("as production holds it today (the refunded bank payment was never stored under its own id): nothing is flipped, the revoke is loud", async () => {
      freshDb("refund_asprod");
      const now = Date.now();
      seedUser(user(), emailOf(keptCard()), { tier: "pro", tier_expires_at: iso(now + 1 * DAY) });
      // Production rows of this learner (16 Oct read): the card row, and the duplicate row Revenue Ops marked refunded by hand.
      seedSub({ user_id: user(), tier: "first_month_19", status: "active", provider_payment_id: cardPay(), whop_membership_id: null, amount_cents: 1900, started_at: iso(now - 29 * DAY), expires_at: iso(now + 1 * DAY), granted: [{ payment_id: cardPay(), added_months: 1, amount_cents: 1900, granted_at: iso(now - 29 * DAY) }] });
      seedSub({ user_id: user(), tier: "first_month_19", status: "refunded", provider_payment_id: cardPay(), whop_membership_id: null, amount_cents: 1900, started_at: iso(now + 1 * DAY), expires_at: iso(now + 31 * DAY), granted: [{ payment_id: cardPay(), added_months: 1, amount_cents: 1900, granted_at: iso(now - 29 * DAY) }] });
      const before = state();
      const { msgId, body } = envelope("refund.created", refundObj());
      const got = await deliver(body, signedV1(msgId, body));
      const after = state();
      // WHOP_PENDING_REVOKE is absent in production. KNOWN GAP (reported to Kassa, not fixed here: a
      // money-path route change): the route does try to record whop_revoke_unmatched, but with no
      // resolved user the user_events insert fails on user_id NOT NULL and is swallowed, so the only
      // trace is the Sentry warning. This case pins that behaviour so a fix shows up as a change.
      const warned = sent.sentry.filter((x) => x.level === "warning" && /matched no whop subscription/.test(x.message));
      const droppedRecord = pg.log.filter((l) => l.table === "user_events" && l.method === "POST" && /^23502 /.test(l.error ?? ""));
      const pass = got.status === 200 && got.json.error === "revoke matched no subscription" && JSON.stringify(after.subs) === JSON.stringify(before.subs)
        && JSON.stringify(after.users) === JSON.stringify(before.users) && warned.length === 1 && after.events.length === 0 && after.claims.length === 0 && droppedRecord.length === 1;
      record("refund: production state today", "refund (real) against the production rows of that learner", "200 {error: 'revoke matched no subscription'}; no subscription, user or claim change (the card month stays); one Sentry warning. KNOWN GAP: the whop_revoke_unmatched record is attempted with no user and fails on user_events.user_id NOT NULL (swallowed), so nothing durable is kept", got, after, pass, { known_gap: "whop_revoke_unmatched insert dropped (user_id NOT NULL)", dropped_insert: droppedRecord.map((l) => l.error) });
      expect(got.status).toBe(200);
      expect(got.json.error).toBe("revoke matched no subscription");
      expect(after.subs).toEqual(before.subs);
      expect(after.users).toEqual(before.users);
      expect(warned).toHaveLength(1);
      expect(after.events).toEqual([]);
      expect(after.claims).toEqual([]);
      expect(droppedRecord).toHaveLength(1);
    });

    it("sole payment refunded: its row flips to refunded and the learner drops to free", async () => {
      freshDb("refund_sole");
      const now = Date.now();
      seedUser(user(), emailOf(keptCard()), { tier: "pro", tier_expires_at: iso(now + 20 * DAY) });
      seedSub({ user_id: user(), tier: "first_month_19", status: "active", provider_payment_id: bankPay(), whop_membership_id: idOf(refundedBank().membership), amount_cents: 1900, started_at: iso(now - 10 * DAY), expires_at: iso(now + 20 * DAY), granted: [{ payment_id: bankPay(), added_months: 1, amount_cents: 1900, granted_at: iso(now - 10 * DAY) }] });
      const { msgId, body } = envelope("refund.created", refundObj());
      const got = await deliver(body, signedV1(msgId, body));
      const after = state();
      const u = after.users.find((x) => x.id === user())!;
      const redo = await deliver(body, signedV1(msgId, body));
      const after2 = state();
      const pass = got.status === 200 && after.subs[0].status === "refunded" && u.tier === "free"
        && redo.status === 200 && JSON.stringify(after2.subs) === JSON.stringify(after.subs) && JSON.stringify(after2.users) === JSON.stringify(after.users);
      record("refund: sole payment", "refund (real), the refunded payment stored as its own row", "200; that row refunded; learner free; redelivery changes nothing", got, after2, pass, { redelivery: { status: redo.status, body: redo.json } });
      expect(got.status).toBe(200);
      expect(after.subs[0].status).toBe("refunded");
      expect(u.tier).toBe("free");
      expect(after2.subs).toEqual(after.subs);
      expect(after2.users).toEqual(after.users);
    });

    it("double payment, one refunded (the 10 Oct case stored correctly): only the refunded row flips; Pro runs to the kept card row's end", async () => {
      freshDb("refund_double");
      const now = Date.now();
      seedUser(user(), emailOf(keptCard()), { tier: "pro", tier_expires_at: iso(now + 31 * DAY) });
      seedSub({ user_id: user(), tier: "first_month_19", status: "active", provider_payment_id: cardPay(), whop_membership_id: idOf(keptCard().membership), amount_cents: 1900, started_at: iso(now - 29 * DAY), expires_at: iso(now + 1 * DAY), granted: [{ payment_id: cardPay(), added_months: 1, amount_cents: 1900, granted_at: iso(now - 29 * DAY) }] });
      seedSub({ user_id: user(), tier: "first_month_19", status: "active", provider_payment_id: bankPay(), whop_membership_id: idOf(refundedBank().membership), amount_cents: 1900, started_at: iso(now + 1 * DAY), expires_at: iso(now + 31 * DAY), granted: [{ payment_id: bankPay(), added_months: 1, amount_cents: 1900, granted_at: iso(now - 29 * DAY) }] });
      const before = state();
      const { msgId, body } = envelope("refund.created", refundObj());
      const got = await deliver(body, signedV1(msgId, body));
      const after = state();
      const card = after.subs.find((s) => s.provider_payment_id === cardPay())!;
      const cardBefore = before.subs.find((s) => s.provider_payment_id === cardPay())!;
      const bank = after.subs.find((s) => s.provider_payment_id === bankPay())!;
      const u = after.users.find((x) => x.id === user())!;
      const pass = got.status === 200 && bank.status === "refunded" && JSON.stringify(card) === JSON.stringify(cardBefore) && u.tier === "pro" && ms(u.tier_expires_at) === ms(card.expires_at);
      record("refund: double payment", "refund (real), both payments stored as their own rows", "200; the bank row refunded, the card row untouched; learner pro until the card row's end (what Revenue Ops did by hand on 10 Oct)", got, after, pass);
      expect(got.status).toBe(200);
      expect(bank.status).toBe("refunded");
      expect(card).toEqual(cardBefore);
      expect(u.tier).toBe("pro");
      expect(ms(u.tier_expires_at)).toBe(ms(card.expires_at));
    });
  });

  // ── a-whop-replay-tests-1106: refund, dispute, renewal failure and dunning recovery ──
  // Fixture sources: refund and payments are the real redacted bodies. The dispute and payment.failed
  // envelopes are SYNTHESIZED (no real delivery of either exists in the fixtures): dispute shape from the
  // Whop docs (id dspt_, status enum, nested payment) and from what extractWhopRevoke reads; payment.failed
  // is the real renewal-cycle payment body with substatus failed, a decline code and payments_failed set.
  // Flags: the flip set above (WHOP_ATOMIC_GRANTS_ENABLED on, WHOP_PENDING_REVOKE absent).
  describe("lifecycle: refund, dispute, renewal failure, dunning recovery", () => {
    const iso = (t: number) => new Date(t).toISOString();
    const user = () => meta(keptCard()).medpruef_user_id as string;
    const bankPay = () => idOf(refundedBank());
    const seedBank = (now: number, tierExp = 20 * DAY) => {
      seedUser(user(), emailOf(keptCard()), { tier: "pro", tier_expires_at: iso(now + tierExp) });
      seedSub({ user_id: user(), tier: "first_month_19", status: "active", provider_payment_id: bankPay(), whop_membership_id: idOf(refundedBank().membership), amount_cents: 1900, started_at: iso(now - 10 * DAY), expires_at: iso(now + tierExp), granted: [{ payment_id: bankPay(), added_months: 1, amount_cents: 1900, granted_at: iso(now - 10 * DAY) }] });
    };
    // Whop's documented DisputePayment carries only these fields (no metadata, user or membership).
    const documentedDisputePayment = (): Json => {
      const p = refundObj().payment as Json;
      return { id: p.id, amount: p.total, currency: p.currency, payment_method_type: p.payment_method_type, card_brand: p.card_brand, card_last4: p.card_last4, created_at: p.created_at };
    };
    const disputeObj = (status: string, id = "dspt_RPdispute0001"): Json => ({ id, amount: 19, currency: "eur", status, reason: "fraudulent", created_at: new Date().toISOString(), payment: documentedDisputePayment() });

    it("full refund: row refunded, learner free, redelivery and a second refund event of the same refund change nothing", async () => {
      freshDb("lc_refund_full");
      seedBank(Date.now());
      const e = envelope("refund.created", refundObj());
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      const e2 = envelope("refund.updated", refundObj());
      const dup = await deliver(e2.body, signedV1(e2.msgId, e2.body));
      const again = await deliver(e.body, signedV1(e.msgId, e.body));
      const after2 = state();
      const claim = after.claims.filter((c) => c.event_id === `refund:${idOf(refundObj())}`);
      const pass = got.status === 200 && got.json.revoked === true && after.subs[0].status === "refunded" && after.users[0].tier === "free" && claim.length === 1
        && dup.json.duplicate === true && again.json.duplicate === true && JSON.stringify(after2.subs) === JSON.stringify(after.subs) && JSON.stringify(after2.users) === JSON.stringify(after.users) && after2.claims.length === after.claims.length;
      record("lifecycle: full refund", "refund (real)", "200 revoked; row refunded; free; one refund: claim; refund.updated and redelivery answer duplicate, no state change", got, after2, pass, { payment_events: after.pevents.map((x) => ({ event: x.event, payment_id: x.payment_id, matched: x.matched, user_id: x.user_id })), webhook_attempts_rows: after.attempts.length, known_gap: "the only funnel row is the general mirror keyed on the refund id with no user; no revoke outcome row, no webhook_attempts row" });
      expect(got.json.revoked).toBe(true);
      expect(after.subs[0].status).toBe("refunded");
      expect(after.users[0].tier).toBe("free");
      expect(claim).toHaveLength(1);
      expect(dup.json.duplicate).toBe(true);
      expect(again.json.duplicate).toBe(true);
      expect(after2.subs).toEqual(after.subs);
      expect(after2.users).toEqual(after.users);
      expect(after2.claims).toEqual(after.claims);
      // The general webhook_received row written before the revoke branch is keyed on the refund id (not the
      // payment) with no user, and the revoke itself adds no outcome row; no webhook_attempts row either
      // (known gaps, followup).
      expect(after.pevents).toHaveLength(1);
      expect(after.pevents[0]).toMatchObject({ event: "webhook_received", user_id: null, payment_id: idOf(refundObj()), matched: false });
      expect(after.attempts).toEqual([]);
      expect(after.events.map((x) => x.event_type)).toContain("whop_subscription_revoked");
    });

    it("renewal payment refunded: only that month is removed, the first month keeps Pro (row window cut back)", async () => {
      freshDb("lc_refund_renewal");
      const first = grantMonthly();
      const u = meta(first).medpruef_user_id as string;
      seedUser(u, emailOf(first));
      const e1 = envelope("payment.succeeded", first);
      await deliver(e1.body, signedV1(e1.msgId, e1.body));
      const cycle = renewalCycle();
      const renewal: Json = { ...cycle, id: "pay_RPlcRenewRefund", plan: { ...(first.plan as Json) }, membership: { ...(cycle.membership as Json), id: idOf(first.membership) }, metadata: null, user: first.user };
      whopObjects.set(idOf(renewal), renewal);
      const afterFirst = state();
      const firstEnd = ms(afterFirst.subs[0].expires_at);
      const e2 = envelope("payment.succeeded", renewal);
      await deliver(e2.body, signedV1(e2.msgId, e2.body));
      const mid = state();
      const rf: Json = { ...refundObj(), id: "rf_RPlcRenewRefund", payment: { ...(refundObj().payment as Json), id: idOf(renewal), metadata: null } };
      const e3 = envelope("refund.created", rf);
      const got = await deliver(e3.body, signedV1(e3.msgId, e3.body));
      const after = state();
      const sub = after.subs[0];
      const tier = after.users[0];
      record("lifecycle: renewal refunded", "payment-grant-monthly then payment-renewal-cycle (real), refund body re-pointed at the renewal payment", "200; the refunded month leaves the row; Pro stays on the first month's window or the row is refunded with the user on the surviving window", got, after, got.status === 200 && sub.status === "active" && ms(sub.expires_at) === firstEnd && tier.tier === "pro" && ms(tier.tier_expires_at) === firstEnd, { sub_status: sub.status, expires_before: mid.subs[0].expires_at, expires_after: sub.expires_at, user_tier: tier.tier, user_expires: tier.tier_expires_at, first_month_end: iso(firstEnd) });
      expect(got.status).toBe(200);
      expect(mid.subs[0].granted_payment_ids).toHaveLength(2);
      expect(sub.status).toBe("active");
      expect(ms(sub.expires_at)).toBe(firstEnd);
      expect(tier.tier).toBe("pro");
      expect(ms(tier.tier_expires_at)).toBe(ms(sub.expires_at));
      expect(sub.granted_payment_ids.map((g) => g.payment_id)).toEqual([first.id]);
    });

    it("partial refund (5 of 19 EUR): the handler reads no amount, so Pro is revoked in full (pinned; gap)", async () => {
      freshDb("lc_refund_partial");
      seedBank(Date.now());
      const rf: Json = { ...refundObj(), id: "rf_RPpartial0001", amount: 5.0 };
      const e = envelope("refund.created", rf);
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      const again = await deliver(e.body, signedV1(e.msgId, e.body));
      const after2 = state();
      const pass = got.status === 200 && after.subs[0].status === "refunded" && after.users[0].tier === "free" && again.json.duplicate === true;
      record("lifecycle: partial refund", "refund (real) with amount 5.0 of 19.0 (synthesized amount)", "GAP PINNED: 200; whole row refunded and learner free although only 5 of 19 EUR went back; redelivery duplicate", got, after2, pass, { known_gap: "partial refund revokes full access (no amount comparison)" });
      expect(got.status).toBe(200);
      expect(after.subs[0].status).toBe("refunded");
      expect(after.users[0].tier).toBe("free");
      expect(again.json.duplicate).toBe(true);
      expect(after2.subs).toEqual(after.subs);
    });

    it("dispute opened: access revoked at once, claim keyed on the dispute id, redelivery changes nothing", async () => {
      freshDb("lc_dispute_open");
      seedBank(Date.now());
      const e = envelope("dispute.created", disputeObj("needs_response"));
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      const again = await deliver(e.body, signedV1(e.msgId, e.body));
      const after2 = state();
      const pass = got.status === 200 && got.json.revoked === true && after.subs[0].status === "refunded" && after.users[0].tier === "free"
        && after.claims.some((c) => c.event_id === "refund:dspt_RPdispute0001") && again.json.duplicate === true && JSON.stringify(after2.subs) === JSON.stringify(after.subs);
      record("lifecycle: dispute opened", "dispute.created (synthesized from Whop docs, real refunded payment nested)", "200 revoked; row refunded; free; refund:dspt claim; redelivery duplicate", got, after2, pass);
      expect(got.json.revoked).toBe(true);
      expect(after.subs[0].status).toBe("refunded");
      expect(after.users[0].tier).toBe("free");
      expect(after.claims.map((c) => c.event_id)).toContain("refund:dspt_RPdispute0001");
      expect(again.json.duplicate).toBe(true);
      expect(after2.subs).toEqual(after.subs);
      expect(after2.users).toEqual(after.users);
    });

    it("dispute lost after it was opened: dispute.updated of the same dispute is a duplicate, nothing changes", async () => {
      freshDb("lc_dispute_lost");
      seedBank(Date.now());
      const e1 = envelope("dispute.created", disputeObj("needs_response"));
      await deliver(e1.body, signedV1(e1.msgId, e1.body));
      const mid = state();
      const e2 = envelope("dispute.updated", disputeObj("lost"));
      const got = await deliver(e2.body, signedV1(e2.msgId, e2.body));
      const after = state();
      const pass = got.status === 200 && got.json.duplicate === true && JSON.stringify(after.subs) === JSON.stringify(mid.subs) && JSON.stringify(after.users) === JSON.stringify(mid.users);
      record("lifecycle: dispute lost", "dispute.updated status lost (synthesized), same dispute id", "200 duplicate; row stays refunded, learner stays free", got, after, pass);
      expect(got.json.duplicate).toBe(true);
      expect(after.subs).toEqual(mid.subs);
      expect(after.users).toEqual(mid.users);
    });

    it("dispute lost with no earlier dispute event delivered: revokes then", async () => {
      freshDb("lc_dispute_lost_only");
      seedBank(Date.now());
      const e = envelope("dispute.updated", disputeObj("lost", "dspt_RPdispute0002"));
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      record("lifecycle: dispute lost, first sight", "dispute.updated status lost (synthesized)", "200 revoked; row refunded; free", got, after, got.json.revoked === true && after.subs[0].status === "refunded" && after.users[0].tier === "free");
      expect(got.json.revoked).toBe(true);
      expect(after.subs[0].status).toBe("refunded");
      expect(after.users[0].tier).toBe("free");
    });

    it("dispute won is not distinguished: dispute.updated status won also revokes (pinned; gap, nothing restores Pro)", async () => {
      freshDb("lc_dispute_won");
      seedBank(Date.now());
      const e = envelope("dispute.updated", disputeObj("won", "dspt_RPdispute0003"));
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      record("lifecycle: dispute won", "dispute.updated status won (synthesized)", "GAP PINNED: the status is ignored, a won dispute revokes like a lost one", got, after, got.json.revoked === true && after.users[0].tier === "free", { known_gap: "dispute status ignored: won/prevented/warning_closed revoke" });
      expect(got.json.revoked).toBe(true);
      expect(after.users[0].tier).toBe("free");
    });

    // renewal failure and recovery share one learner
    const failedBody = (payId: string, membership: string, plan: Json, userObj: unknown): Json => ({
      ...renewalCycle(), id: payId, status: "open", substatus: "failed", paid_at: null, payments_failed: 1, decline_code: "insufficient_funds",
      failure_message: "Your card has insufficient funds.", recovery_url: null, plan, membership: { ...(renewalCycle().membership as Json), id: membership }, metadata: null, user: userObj,
    });
    const seedRenewalLearner = async () => {
      const first = grantMonthly();
      const u = meta(first).medpruef_user_id as string;
      seedUser(u, emailOf(first));
      const e1 = envelope("payment.succeeded", first);
      await deliver(e1.body, signedV1(e1.msgId, e1.body));
      return { first, u };
    };

    it("renewal payment failed: Pro and the row untouched, one dunning claim, funnel row with the decline code, one mail, redelivery is a duplicate", async () => {
      freshDb("lc_renewal_failed");
      const { first, u } = await seedRenewalLearner();
      const mid = state();
      const failed = failedBody("pay_RPlcFailed0001", idOf(first.membership), { ...(first.plan as Json) }, first.user);
      const e = envelope("payment.failed", failed);
      sent.mail.length = 0;
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      const mails = sent.mail.length;
      const again = await deliver(e.body, signedV1(e.msgId, e.body));
      const after2 = state();
      const funnel = after.pevents.filter((x) => x.payment_id === "pay_RPlcFailed0001" && x.event === "webhook_received" && (x.metadata as Json | null)?.decline_code);
            const pass = got.status === 200 && JSON.stringify(after.subs) === JSON.stringify(mid.subs) && JSON.stringify(after.users) === JSON.stringify(mid.users)
        && after.pevents.filter((x) => x.payment_id === "pay_RPlcFailed0001").length === 2 && after2.pevents.filter((x) => x.payment_id === "pay_RPlcFailed0001").length === 3 && after.claims.some((c) => c.event_id === "recover:pay_RPlcFailed0001") && funnel.length === 1 && (funnel[0].metadata as Json)?.decline_code === "insufficient_funds"
        && mails === 1 && again.json.duplicate === true && sent.mail.length === 1;
      record("lifecycle: renewal failed", "payment-renewal-cycle (real) body with status failed, decline_code insufficient_funds (synthesized failure fields)", "200; row and Pro unchanged; recover: claim; one webhook_received funnel row with decline_code; one dunning mail; redelivery duplicate, no second mail", got, after2, pass, { mails_recorded: mails });
      expect(got.status).toBe(200);
      expect(after.subs).toEqual(mid.subs);
      expect(after.users).toEqual(mid.users);
      expect(after.users.find((x) => x.id === u)!.tier).toBe("pro");
      expect(after.claims.map((c) => c.event_id)).toContain("recover:pay_RPlcFailed0001");
      expect(funnel).toHaveLength(1);
      // The first delivery writes the generic mirror row (no user) and the dunning row; a redelivery adds only another mirror row.
      expect(after.pevents.filter((x) => x.payment_id === "pay_RPlcFailed0001")).toHaveLength(2);
      expect(after2.pevents.filter((x) => x.payment_id === "pay_RPlcFailed0001")).toHaveLength(3);
      expect((funnel[0].metadata as Json).decline_code).toBe("insufficient_funds");
      expect(after.events.map((x) => x.event_type)).toContain("whop_payment_recovery_needed");
      expect(mails).toBe(1);
      expect(sent.mail[0].to).toBe(emailOf(first));
      expect(again.json.duplicate).toBe(true);
      expect(sent.mail).toHaveLength(1);
    });

    it("dunning recovery: failed, then the same charge succeeds: the row extends one month once, the dunning claim stays, a redelivery changes nothing", async () => {
      freshDb("lc_dunning_recovery");
      const { first, u } = await seedRenewalLearner();
      const mid = state();
      const failed = failedBody("pay_RPlcRecover01", idOf(first.membership), { ...(first.plan as Json) }, first.user);
      const ef = envelope("payment.failed", failed);
      await deliver(ef.body, signedV1(ef.msgId, ef.body));
      const cycle = renewalCycle();
      const paid: Json = { ...cycle, id: "pay_RPlcRecover01", plan: { ...(first.plan as Json) }, membership: { ...(cycle.membership as Json), id: idOf(first.membership) }, metadata: null, user: first.user };
      whopObjects.set(idOf(paid), paid);
      const es = envelope("payment.succeeded", paid);
      const got = await deliver(es.body, signedV1(es.msgId, es.body));
      const after = state();
      const redo = await deliver(es.body, signedV1(es.msgId, es.body));
      const after2 = state();
      const sub = after.subs[0];
      const prevEnd = ms(mid.subs[0].expires_at);
      const pass = got.status === 200 && after.subs.length === 1 && Math.abs(ms(sub.expires_at) - addMonths(prevEnd, 1)) < HOUR
        && sub.granted_payment_ids.map((g) => g.payment_id).includes("pay_RPlcRecover01") && after.users.find((x) => x.id === u)!.tier === "pro"
        && after.claims.some((c) => c.event_id === "recover:pay_RPlcRecover01") && after.claims.some((c) => c.event_id === "pay_RPlcRecover01")
        && JSON.stringify(after2.subs) === JSON.stringify(after.subs) && JSON.stringify(after2.users) === JSON.stringify(after.users);
      record("lifecycle: dunning recovery", "failed delivery then payment-renewal-cycle (real) succeeded under the same payment id", "200; same row +1 month; both claims present; Pro; redelivery of the success is a no-op", got, after2, pass, { redelivery: { status: redo.status, body: redo.json } });
      expect(got.status).toBe(200);
      expect(after.subs).toHaveLength(1);
      expect(Math.abs(ms(sub.expires_at) - addMonths(prevEnd, 1))).toBeLessThan(HOUR);
      expect(sub.granted_payment_ids.map((g) => g.payment_id)).toEqual([first.id, "pay_RPlcRecover01"]);
      expect(after.users.find((x) => x.id === u)!.tier).toBe("pro");
      expect(after.claims.map((c) => c.event_id)).toEqual(expect.arrayContaining(["recover:pay_RPlcRecover01", "pay_RPlcRecover01"]));
      expect(after2.subs).toEqual(after.subs);
      expect(after2.users).toEqual(after.users);
    });

    it("refund of a learner with a failed payment inside the 7 day dunning window and no other cover: the downgrade is deferred (pinned; gap, refunded Pro stays)", async () => {
      freshDb("lc_refund_in_dunning");
      const now = Date.now();
      seedBank(now, 20 * DAY);
      const fb = failedBody("pay_RPlcFailed0002", idOf(refundedBank().membership), { ...((refundObj().payment as Json).plan as Json) }, (refundObj().payment as Json).user);
      const ef = envelope("payment.failed", fb);
      await deliver(ef.body, signedV1(ef.msgId, ef.body));
      const e = envelope("refund.created", refundObj());
      const got = await deliver(e.body, signedV1(e.msgId, e.body));
      const after = state();
      record("lifecycle: refund inside dunning window", "payment.failed (synthesized) then refund (real)", "GAP PINNED: row refunded but the learner stays Pro (downgrade deferred by the dunning grace check inside the revoke SQL) until the old tier_expires_at", got, after, got.status === 200 && after.subs[0].status === "refunded" && after.users[0].tier === "pro", { sub_status: after.subs[0]?.status, user_tier: after.users[0]?.tier, user_expires: after.users[0]?.tier_expires_at, kept_by_dunning: after.users[0]?.tier === "pro", known_gap: "refund inside the 7 day dunning window defers the downgrade, refunded learner keeps Pro" });
      expect(got.status).toBe(200);
      expect(after.subs[0].status).toBe("refunded");
      expect(after.users[0].tier).toBe("pro");
      const revokedEvt = (pg.rows(`SELECT event_data FROM public.user_events WHERE event_type = 'whop_subscription_revoked'`) as Array<{ event_data: Json }>)[0]?.event_data;
      expect(revokedEvt?.pro_revoked).toBe(false);
    });

    it("tampered body: a refund signed as an original, delivered with the amount changed, is refused 401 and nothing moves", async () => {
      freshDb("lc_tampered");
      seedBank(Date.now());
      const before = state();
      const e = envelope("refund.created", refundObj());
      const headers = signedV1(e.msgId, e.body);
      const tampered = e.body.replace('"amount":19', '"amount":1900');
      expect(tampered).not.toBe(e.body);
      const got = await deliver(tampered, headers);
      const after = state();
      const pass = got.status === 401 && JSON.stringify(after.subs) === JSON.stringify(before.subs) && JSON.stringify(after.users) === JSON.stringify(before.users) && after.claims.length === 0 && after.attempts.map((a) => a.result).join() === "sig_invalid";
      record("lifecycle: tampered body", "refund (real) signed, body altered after signing", "401; one sig_invalid attempt; no claim, no row or user change", got, after, pass);
      expect(got.status).toBe(401);
      expect(after.subs).toEqual(before.subs);
      expect(after.users).toEqual(before.users);
      expect(after.claims).toEqual([]);
      expect(after.attempts.map((a) => a.result)).toEqual(["sig_invalid"]);
    });
  });
});
