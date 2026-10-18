import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), create: vi.fn(), log: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, forgetGuardUser: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: m.log }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/mail-suppression", () => ({ sendUnlessSuppressed: m.send }));
vi.mock("@/lib/whop", async (orig) => ({ ...(await orig<typeof import("@/lib/whop")>()), tierToWhopPlan: (t: string) => `plan_${t}`, createWhopCheckoutSession: m.create }));

import { POST as checkout } from "@/app/api/whop/checkout/route";
import { GET as learnerGet, POST as learnerPost } from "@/app/api/ticket-renewal/route";
import { runHalfYearRenewals, examDatePassed, laterDay, reminderDue, stopDue } from "@/lib/pricing-v2/half-year-server";
import { ensureReverseTrial, accessIsReverseTrialOnly, resetReverseTrialCache } from "@/lib/pricing-v2/reverse-trial-server";
import { runTicketProofCleanup } from "@/lib/pricing-v2/ticket-server";
import { sittingOptions } from "@/lib/pricing-v2/sitting-pass";

const DAY = 86_400_000;
const free = { tier: "free", role: "user", tier_expires_at: null, email: "a@example.com" };
// The first upcoming Vienna sitting from OFFICIAL_SITTINGS keeps the test on real data.
const nextSitting = () => sittingOptions("kenntnispruefung")[0];
const req = (body: unknown) => new NextRequest("https://medpruf.com/api/whop/checkout", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  resetReverseTrialCache();
  m.guard.mockResolvedValue({ userId: "u1" });
  m.log.mockResolvedValue(undefined);
  m.create.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.example/c" });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/whop/checkout with PRICING_V2_ENABLED", () => {
  const db = (user = free, subs: unknown[] = []) => createFakeSupabase((c: FakeCall): FakeResult => {
    if (c.table === "users") return { data: user };
    if (c.table === "subscriptions") return { data: subs };
    return { data: [] };
  }).sb;

  it("flag off: a v2 tier is refused and today's tiers sell", async () => {
    m.client.mockReturnValue(db());
    expect((await checkout(req({ tier: "flex_month" }))).status).toBe(400);
    expect((await checkout(req({ tier: "first_month_19" }))).status).toBe(200);
  });

  it("flag on: old tiers refused for new buyers; the pass needs an official sitting and carries it to Whop", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    m.client.mockReturnValue(db());
    expect((await checkout(req({ tier: "first_3mo_27" }))).status).toBe(400);
    const noSitting = await checkout(req({ tier: "sitting_pass" }));
    expect(noSitting.status).toBe(400);
    expect(await noSitting.json()).toMatchObject({ code: "SITTING_REQUIRED" });
    expect(await (await checkout(req({ tier: "sitting_pass", sitting: { bank: "kenntnispruefung", date: "2030-01-01" } }))).json()).toMatchObject({ code: "SITTING_REQUIRED" });
    const s = nextSitting();
    const ok = await checkout(req({ tier: "sitting_pass", sitting: { bank: s.bank, date: s.date } }));
    expect(ok.status).toBe(200);
    expect(m.create.mock.calls[0][0].metadata).toMatchObject({ tier: "sitting_pass", sitting_bank: "kenntnispruefung", sitting_date: s.date, sitting_last_day: s.lastDay });
    expect((await checkout(req({ tier: "flex_month" }))).status).toBe(200);
  });

  it("flag on: 6 months and the ticket are not sold until their promises run", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    m.client.mockReturnValue(db());
    for (const tier of ["half_year", "guarantee_ticket"]) {
      const r = await checkout(req({ tier }));
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ code: "PLAN_NOT_READY" });
    }
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
    vi.stubEnv("HALF_YEAR_REMINDER_EMAILS_ENABLED", "true");
    expect(await (await checkout(req({ tier: "half_year" }))).json()).toMatchObject({ code: "SITTING_REQUIRED" });
    const s = nextSitting();
    expect((await checkout(req({ tier: "half_year", sitting: { bank: s.bank, date: s.date } }))).status).toBe(200);
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0].metadata).toMatchObject({ tier: "half_year", sitting_last_day: s.lastDay });
  });

  it("a learner whose only access is the reverse trial can buy; a one-time v2 plan never extends running paid access", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    const trialEnd = new Date(Date.now() + 2 * DAY).toISOString();
    m.client.mockReturnValue(db({ tier: "pro", role: "user", tier_expires_at: trialEnd, email: null } as never, [{ tier: "reverse_trial", expires_at: trialEnd }]));
    expect((await checkout(req({ tier: "flex_month" }))).status).toBe(200);
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const paidEnd = new Date(Date.now() + 20 * DAY).toISOString();
    m.client.mockReturnValue(createFakeSupabase((c: FakeCall): FakeResult => {
      if (c.table === "users") return { data: { tier: "pro", role: "user", tier_expires_at: paidEnd } };
      if (c.table === "subscriptions") return { data: [{ tier: "sitting_pass", payment_provider: "whop", provider_payment_id: "pay_1", whop_membership_id: null, expires_at: paidEnd }] };
      return { data: [] };
    }).sb);
    const s = nextSitting();
    const r = await checkout(req({ tier: "sitting_pass", sitting: { bank: s.bank, date: s.date } }));
    expect(await r.json()).toMatchObject({ code: "EXTENSION_UNAVAILABLE" });
  });
});

describe("reverse trial on the server", () => {
  it("reads nothing while off or for an older account; starts for a new Telegram-linked one", async () => {
    const calls: FakeCall[] = [];
    const fake = createFakeSupabase((c) => { calls.push(c); return c.table === "users" ? { data: { email: "n@example.com", email_verified_at: new Date().toISOString(), telegram_id: 777001, is_banned: false } } : c.table === "rpc:start_reverse_trial" ? { data: { started: true, expires_at: "2026-10-23T10:00:00Z" } } : { data: null }; });
    const cand = { createdAt: new Date().toISOString(), role: "user", tier: "free", tierExpiresAt: null };
    expect(await ensureReverseTrial(fake.sb, { userId: "u1", candidate: cand, headers: new Headers() })).toMatchObject({ active: false });
    expect(calls).toHaveLength(0);
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
    vi.stubEnv("REVERSE_TRIAL_ENABLED", "true");
    vi.stubEnv("REVERSE_TRIAL_SINCE", new Date(Date.now() - DAY).toISOString());
    expect(await ensureReverseTrial(fake.sb, { userId: "u1", candidate: { ...cand, createdAt: new Date(Date.now() - 5 * DAY).toISOString() }, headers: new Headers() })).toMatchObject({ active: false });
    expect(calls).toHaveLength(0);
    const started = await ensureReverseTrial(fake.sb, { userId: "u1", candidate: cand, headers: new Headers({ "x-forwarded-for": "1.2.3.4" }) });
    expect(started).toEqual({ active: true, endsAt: "2026-10-23T10:00:00Z", started: true });
    const rpc = calls.find((c) => c.table === "rpc:start_reverse_trial")!.payload as Record<string, unknown>;
    expect(rpc.p_days).toBe(3);
    expect(String(rpc.p_email_key)).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc.p_telegram_id).toBe(777001);
    expect(JSON.stringify(rpc)).not.toContain("n@example.com");
    expect(JSON.stringify(rpc)).not.toContain("1.2.3.4");
  });
  it("a confirmed email without Telegram gets no trial, only the link prompt state (a-trial-phone-gate)", async () => {
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
    vi.stubEnv("REVERSE_TRIAL_ENABLED", "true");
    vi.stubEnv("REVERSE_TRIAL_SINCE", new Date(Date.now() - DAY).toISOString());
    const calls: FakeCall[] = [];
    const fake = createFakeSupabase((c) => { calls.push(c); return c.table === "users" ? { data: { email: "n@example.com", email_verified_at: new Date().toISOString(), telegram_id: null, is_banned: false } } : { data: { started: true, expires_at: "2026-10-23T10:00:00Z" } }; });
    const cand = { createdAt: new Date().toISOString(), role: "user", tier: "free", tierExpiresAt: null };
    expect(await ensureReverseTrial(fake.sb, { userId: "u9", candidate: cand, headers: new Headers() })).toEqual({ active: false, endsAt: null, started: false, needsTelegram: true });
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
    const before = calls.length;
    expect(await ensureReverseTrial(fake.sb, { userId: "u9", candidate: cand, headers: new Headers() })).toMatchObject({ needsTelegram: true });
    expect(calls.length).toBe(before);
    // A banned account gets neither the trial nor the prompt.
    const banned = createFakeSupabase(() => ({ data: { email: "b@example.com", email_verified_at: null, telegram_id: null, is_banned: true } }));
    expect(await ensureReverseTrial(banned.sb, { userId: "u10", candidate: cand, headers: new Headers() })).toEqual({ active: false, endsAt: null, started: false });
  });
  it("an unverified account gets no trial", async () => {
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
    vi.stubEnv("REVERSE_TRIAL_ENABLED", "true");
    vi.stubEnv("REVERSE_TRIAL_SINCE", new Date(Date.now() - DAY).toISOString());
    const calls: FakeCall[] = [];
    const fake = createFakeSupabase((c) => { calls.push(c); return c.table === "users" ? { data: { email: "n@example.com", email_verified_at: null, telegram_id: null } } : { data: null }; });
    expect(await ensureReverseTrial(fake.sb, { userId: "u1", candidate: { createdAt: new Date().toISOString(), role: "user", tier: "free", tierExpiresAt: null }, headers: new Headers() })).toMatchObject({ active: false });
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);
    // The "no" is remembered: the next call reads nothing.
    const before = calls.length;
    await ensureReverseTrial(fake.sb, { userId: "u1", candidate: { createdAt: new Date().toISOString(), role: "user", tier: "free", tierExpiresAt: null }, headers: new Headers() });
    expect(calls.length).toBe(before);
  });
  it("trial-only access is recognised; paid rows or a read error are not", async () => {
    const end = new Date(Date.now() + DAY).toISOString();
    const at = (rows: unknown, error?: unknown) => createFakeSupabase(() => (error ? { error } : { data: rows })).sb;
    expect(await accessIsReverseTrialOnly(at([{ tier: "reverse_trial", expires_at: end }]), "u1")).toBe(true);
    expect(await accessIsReverseTrialOnly(at([{ tier: "reverse_trial", expires_at: end }, { tier: "flex_month", expires_at: end }]), "u1")).toBe(false);
    expect(await accessIsReverseTrialOnly(at([]), "u1")).toBe(false);
    expect(await accessIsReverseTrialOnly(at(null, { message: "down" }), "u1")).toBeNull();
    // A manual Pro grant that runs past the trial (or a permanent one) is real access.
    expect(await accessIsReverseTrialOnly(at([{ tier: "reverse_trial", expires_at: end }]), "u1", new Date(), end)).toBe(true);
    expect(await accessIsReverseTrialOnly(at([{ tier: "reverse_trial", expires_at: end }]), "u1", new Date(), new Date(Date.now() + 30 * DAY).toISOString())).toBe(false);
    expect(await accessIsReverseTrialOnly(at([{ tier: "reverse_trial", expires_at: end }]), "u1", new Date(), null)).toBe(false);
  });
});

describe("6-month plan upkeep", () => {
  const now = new Date("2027-05-10T08:30:00Z");
  const snapshot = (nextCharge: string | null, cancelled = false) => ({ snapshot: { provider_state_verified: true, cancel_at_period_end: cancelled, next_charge_at: nextCharge, next_charge_amount_cents: 10000, manage_url: null, billing_cadence: "auto_renews", provider_status: "active", is_trial: false, plan_id: "plan_half", billing_interval_days: 180 }, status: 200 });
  const db = (examDate: string | null, calls: FakeCall[], claimed = new Set<string>()) => createFakeSupabase((c) => {
    calls.push(c);
    if (c.table === "subscriptions") return { data: [{ id: "s1", user_id: "u1", whop_membership_id: "mem_HALF", expires_at: "2027-08-01T00:00:00Z" }] };
    if (c.table === "users") return { data: { email: "h@example.com", language_code: "de", exam_date: examDate } };
    if (c.table === "processed_webhook_events" && c.op === "insert") {
      const id = (c.payload as { event_id: string }).event_id;
      if (claimed.has(id)) return { error: { code: "23505" } };
      claimed.add(id); return { data: { event_id: id } };
    }
    return { data: [] };
  }).sb;

  it("rules: the stop waits a full day after the exam; the reminder fires 6 to 7 days before the charge", () => {
    expect(examDatePassed("2027-05-08", now)).toBe(true);
    expect(examDatePassed("2027-05-09", now)).toBe(false);
    expect(examDatePassed(null, now)).toBe(false);
    expect(laterDay("2027-05-01", "2027-09-01")).toBe("2027-09-01");
    expect(laterDay(null, "2027-09-01")).toBe("2027-09-01");
    expect(laterDay(null, undefined)).toBeNull();
    // Stop before a charge that falls after the exam, within 8 days of it.
    expect(stopDue("2027-05-12", "2027-05-14T10:00:00Z", now)).toBe(true);
    expect(stopDue("2027-05-12", "2027-05-12T20:00:00Z", now)).toBe(false);
    expect(stopDue("2027-09-01", "2027-05-14T10:00:00Z", now)).toBe(false);
    expect(stopDue("2027-05-20", "2027-07-01T00:00:00Z", now)).toBe(false);
    expect(stopDue("2027-05-01", "2027-07-01T00:00:00Z", now)).toBe(true);
    expect(stopDue(null, "2027-05-14T10:00:00Z", now)).toBe(false);
    expect(reminderDue(snapshot(new Date(now.getTime() + 6.5 * DAY).toISOString()).snapshot as never, now)).toBe(true);
    expect(reminderDue(snapshot(new Date(now.getTime() + 8 * DAY).toISOString()).snapshot as never, now)).toBe(false);
    expect(reminderDue(snapshot(new Date(now.getTime() + 6.5 * DAY).toISOString(), true).snapshot as never, now)).toBe(false);
  });

  it("off by default; dry run counts; live cancels at period end once, with an idempotency key", async () => {
    const calls: FakeCall[] = [];
    // Before the cancel the membership renews; the fresh read after it shows the scheduled end.
    let cancelled = false;
    const loadSnapshot = vi.fn(async () => snapshot(cancelled ? null : "2027-07-01T00:00:00Z", cancelled));
    const fetchImpl = vi.fn(async () => { cancelled = true; return new Response("{}", { status: 200 }); });
    expect(await runHalfYearRenewals(db("2027-05-01", calls), now, { loadSnapshot, fetchImpl })).toMatchObject({ autoStop: "off", rows: 0 });
    vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
    expect(await runHalfYearRenewals(db("2027-05-01", calls), now, { loadSnapshot, fetchImpl })).toMatchObject({ autoStop: "dry_run", wouldStop: 1, stopped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
    vi.stubEnv("WHOP_API_KEY", "key");
    const claimed = new Set<string>();
    expect(await runHalfYearRenewals(db("2027-05-01", calls, claimed), now, { loadSnapshot, fetchImpl })).toMatchObject({ autoStop: "live", stopped: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.whop.com/api/v1/memberships/mem_HALF/cancel");
    expect(JSON.parse(String(init.body))).toEqual({ cancel_at_period_end: true });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("half-year-stop:mem_HALF");
    cancelled = false;
    expect(await runHalfYearRenewals(db("2027-05-01", calls, claimed), now, { loadSnapshot, fetchImpl })).toMatchObject({ stopped: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Whop answers 200 but the fresh read does not show a scheduled end: not counted, reported.
    const neverScheduled = vi.fn(async () => snapshot("2027-07-01T00:00:00Z"));
    expect(await runHalfYearRenewals(db("2027-05-01", calls, new Set()), now, { loadSnapshot: neverScheduled, fetchImpl })).toMatchObject({ stopped: 0, failed: 1 });
    // No exam date anywhere: nothing is stopped.
    expect(await runHalfYearRenewals(db(null, calls, new Set()), now, { loadSnapshot, fetchImpl })).toMatchObject({ stopped: 0, wouldStop: 0 });
  });

  it("the 7-day reminder: one claim per membership and charge date, transactional mail", async () => {
    vi.stubEnv("HALF_YEAR_REMINDER_EMAILS_ENABLED", "true");
    m.send.mockResolvedValue({ ok: true });
    const calls: FakeCall[] = [];
    const claimed = new Set<string>();
    const loadSnapshot = vi.fn(async () => snapshot(new Date(now.getTime() + 6.5 * DAY).toISOString()));
    expect(await runHalfYearRenewals(db("2027-09-01", calls, claimed), now, { loadSnapshot })).toMatchObject({ reminded: 1 });
    expect(await runHalfYearRenewals(db("2027-09-01", calls, claimed), now, { loadSnapshot })).toMatchObject({ reminded: 0 });
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.send.mock.calls[0][1]).toBe("transactional");
  });
});

describe("ticket renewal learner route", () => {
  const form = (fields: Record<string, string | Blob>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return new NextRequest("https://medpruf.com/api/ticket-renewal", { method: "POST", body: fd });
  };
  it("is a 404 while TICKET_RENEWAL_ENABLED is off", async () => {
    expect((await learnerGet(new NextRequest("https://medpruf.com/api/ticket-renewal"))).status).toBe(404);
    expect((await learnerPost(form({}))).status).toBe(404);
  });
  it("refuses a booked sitting before the ticket end and stores a valid link request", async () => {
    vi.stubEnv("TICKET_RENEWAL_ENABLED", "true");
    const end = new Date(Date.now() + 20 * DAY).toISOString();
    const calls: FakeCall[] = [];
    m.client.mockReturnValue(createFakeSupabase((c) => {
      calls.push(c);
      if (c.table === "subscriptions") return { data: [{ id: "t1", tier: "guarantee_ticket", status: "active", expires_at: end }] };
      if (c.table === "ticket_renewal_requests" && c.op === "select") return eqVal(c, "id") ? { data: null } : { data: [] };
      return { data: null };
    }).sb);
    const key = "b7908ab9-af3d-46d9-8100-64e8c5b43d4a";
    const early = await learnerPost(form({ idempotency_key: key, kind: "booked_sitting", proof_link: "https://example.org/r", sitting_date: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10) }));
    expect(await early.json()).toMatchObject({ code: "SITTING_NOT_AFTER_END" });
    const bad = await learnerPost(form({ idempotency_key: key, kind: "failed_result", proof_link: "http://example.org/r" }));
    expect(await bad.json()).toMatchObject({ code: "PROOF_REQUIRED" });
    const ok = await learnerPost(form({ idempotency_key: key, kind: "failed_result", proof_link: "https://example.org/result" }));
    expect(ok.status).toBe(200);
    const insert = calls.find((c) => c.table === "ticket_renewal_requests" && c.op === "insert")!.payload as Record<string, unknown>;
    expect(insert).toMatchObject({ id: key, user_id: "u1", subscription_id: "t1", kind: "failed_result", proof_link: "https://example.org/result", proof_path: null });
  });
});

describe("proof cleanup", () => {
  it("skips quietly before the changeset exists", async () => {
    const sb = createFakeSupabase(() => ({ error: { code: "42P01", message: "relation does not exist" } })).sb;
    expect(await runTicketProofCleanup(sb)).toMatchObject({ skipped: "not_applied" });
  });
});
