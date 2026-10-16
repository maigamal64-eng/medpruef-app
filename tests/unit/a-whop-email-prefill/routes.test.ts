import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

// a-whop-email-prefill: both checkout routes. paymentEvents is NOT mocked, so
// the rows it would insert are checked for the address and the URL.
const h = vi.hoisted(() => ({
  guardUser: "user-1",
  handler: (() => ({})) as (c: unknown) => unknown,
  fakes: [] as Array<{ calls: unknown[] }>,
  create: vi.fn(),
  sentryException: vi.fn(),
  sentryMessage: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentryMessage, captureException: h.sentryException }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: h.guardUser }), isPaidAccess: () => false }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => "k", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const fake = createFakeSupabase((c) => h.handler(c) as FakeResult);
    h.fakes.push(fake);
    return fake.sb;
  },
}));
vi.mock("@/lib/whop", async (orig) => ({
  ...(await orig<typeof import("@/lib/whop")>()),
  tierToWhopPlan: () => "plan_fixture",
  createWhopCheckoutSession: h.create,
}));
vi.mock("@/lib/admin/flags", () => ({ flag: async () => true }));
vi.mock("@/lib/mentor/guard", () => ({ mentorResting: async () => false }));
vi.mock("@/lib/mentor/credits/plan-check", () => ({ checkMentorPlan: async () => ({ ok: true }) }));

import { POST as proPost } from "@/app/api/whop/checkout/route";
import { POST as mentorPost } from "@/app/api/mentor/checkout/route";
import { resetPackageCache } from "@/lib/mentor/credits/packages";

const ADDRESS = "user-2684e87d@example.com";
const VERIFIED = "2026-10-20T08:00:00Z";
const BARE = "https://whop.com/checkout/plan_fixture/?session=ch_1";
const MENTOR_USER = "66666666-6666-4666-8666-666666666666";
const SESSION = "88888888-8888-4888-8888-888888888888";
const PACKAGES = [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null }];

let verified: string | null = VERIFIED;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

function proHandler(call: FakeCall): FakeResult {
  if (call.table === "users" && call.columns === "tier,tier_expires_at,role") return { data: { tier: "free", role: "user", tier_expires_at: null } };
  if (call.table === "users" && call.columns === "email") return { data: { email: ADDRESS } };
  if (call.table === "users" && call.columns === "email,email_verified_at") return { data: { email: ADDRESS, email_verified_at: verified } };
  return { data: [] };
}

function mentorHandler(call: FakeCall): FakeResult {
  if (call.table === "users" && call.columns === "email,email_verified_at") return { data: { email: ADDRESS, email_verified_at: verified } };
  if (call.table === "ai_credit_package") return { data: PACKAGES };
  if (call.table === "rpc:mentor_begin_purchase") return { data: { ok: true } };
  if (call.table === "ai_mentor_purchase") return { data: { checkout_session_id: SESSION } };
  return {};
}

const calls = () => h.fakes.flatMap((f) => f.calls) as FakeCall[];
const userCalls = () => calls().filter((c) => c.table === "users");

/** Nothing that is stored, logged or reported may carry the address or a prefilled URL. */
function expectNoLeak() {
  const stored = calls().filter((c) => c.op !== "select").map((c) => JSON.stringify(c.payload ?? null));
  const reported = [...h.sentryException.mock.calls, ...h.sentryMessage.mock.calls, ...consoleSpies.flatMap((s) => s.mock.calls)].map((a) => JSON.stringify(a, (_k, v) => (v instanceof Error ? v.message : v)));
  for (const text of [...stored, ...reported]) {
    expect(text).not.toContain("medpruf.com");
    expect(text).not.toContain("email=");
    expect(text).not.toContain("%40");
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fakes = [];
  resetPackageCache();
  verified = VERIFIED;
  h.create.mockResolvedValue({ id: "ch_1", purchaseUrl: BARE, planId: "plan_fixture" });
  consoleSpies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "info").mockImplementation(() => {})];
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const proReq = () => new NextRequest("https://medpruf.com/api/whop/checkout", { method: "POST", body: JSON.stringify({ tier: "first_month_19" }) });
const mentorReq = (body: unknown = { package_id: "mentor_basis" }) => new NextRequest("https://medpruf.com/api/mentor/checkout", { method: "POST", body: JSON.stringify(body) });

describe("/api/whop/checkout", () => {
  beforeEach(() => { h.guardUser = "user-1"; h.handler = (c) => proHandler(c as FakeCall); });

  it("flag off: the bare URL, the same Whop request and no extra users read", async () => {
    const res = await proPost(proReq());
    expect(res.status).toBe(200);
    expect((await res.json()).purchaseUrl).toBe(BARE);
    expect(h.create.mock.calls[0][0]).toEqual({ planId: "plan_fixture", metadata: { medpruef_user_id: "user-1", tier: "first_month_19" }, redirectUrl: expect.stringMatching(/\/checkout\/success\?tier=first_month_19$/) });
    expect(userCalls().map((c) => c.columns)).toEqual(["tier,tier_expires_at,role", "email"]);
    expectNoLeak();
  });

  it("flag on, unverified address: the bare URL", async () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    verified = null;
    expect((await (await proPost(proReq())).json()).purchaseUrl).toBe(BARE);
    expectNoLeak();
  });

  it("flag on, verified: only the reply carries the address; the Whop request is unchanged", async () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    const off = h.create.mock.calls.length;
    const url = new URL((await (await proPost(proReq())).json()).purchaseUrl);
    expect(url.searchParams.get("email")).toBe(ADDRESS);
    expect(url.searchParams.get("session")).toBe("ch_1");
    expect(url.toString()).toContain("email=lea%2Bkp%40medpruf.com");
    expect(h.create.mock.calls[off][0]).toEqual({ planId: "plan_fixture", metadata: { medpruef_user_id: "user-1", tier: "first_month_19" }, redirectUrl: expect.any(String) });
    // payment_events rows: session id and email_hash, never the address or the URL.
    const events = calls().filter((c) => c.table === "payment_events" && c.op === "insert").map((c) => c.payload as Record<string, unknown>);
    expect(events.map((e) => e.event)).toEqual(["checkout_session_created", "checkout_redirected"]);
    expect(events[0].email_hash).toMatch(/^[0-9a-f]{32}$/);
    expectNoLeak();
  });
});

describe("/api/mentor/checkout", () => {
  beforeEach(() => {
    h.guardUser = MENTOR_USER;
    h.handler = (c) => mentorHandler(c as FakeCall);
    for (const [k, v] of Object.entries({ AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_PACKAGES_ENABLED: "true", WHOP_PLAN_MENTOR_BASIS: "plan_b", MENTOR_BETA_USER_IDS: MENTOR_USER })) vi.stubEnv(k, v);
  });

  it("flag off: the bare URL is stored and returned, no users read", async () => {
    const res = await mentorPost(mentorReq());
    expect(res.status).toBe(200);
    expect((await res.json()).purchase_url).toBe(BARE);
    const attach = calls().find((c) => c.table === "ai_mentor_purchase" && c.op === "update");
    expect((attach?.payload as Record<string, unknown>).purchase_url).toBe(BARE);
    expect(userCalls().filter((c) => c.columns === "email,email_verified_at")).toHaveLength(0);
    expectNoLeak();
  });

  it("flag on, verified: ai_mentor_purchase keeps the bare URL, the reply carries the address", async () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    const body = await (await mentorPost(mentorReq())).json();
    expect(new URL(body.purchase_url).searchParams.get("email")).toBe(ADDRESS);
    const attach = calls().find((c) => c.table === "ai_mentor_purchase" && c.op === "update");
    expect((attach?.payload as Record<string, unknown>).purchase_url).toBe(BARE);
    expect(h.create.mock.calls[0][0].metadata).not.toHaveProperty("email");
    expectNoLeak();
  });

  it("flag on, unverified: the bare URL", async () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    verified = null;
    expect((await (await mentorPost(mentorReq())).json()).purchase_url).toBe(BARE);
    expectNoLeak();
  });

  it("a second tab that waits for the stored session gets the prefill too, the row stays bare", async () => {
    vi.stubEnv("WHOP_CHECKOUT_PREFILL_ENABLED", "true");
    h.handler = (call) => {
      const c = call as FakeCall;
      if (c.table === "rpc:mentor_begin_purchase") return { data: { ok: false, reason: "pending_purchase", checkout_session_id: SESSION } };
      if (c.table === "ai_mentor_purchase") return { data: { checkout_session_id: SESSION, user_id: MENTOR_USER, package_id: "mentor_basis", status: "pending", purchase_url: BARE, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString() } };
      return mentorHandler(c);
    };
    const res = await mentorPost(mentorReq({ package_id: "mentor_basis", idempotency_key: "99999999-9999-4999-8999-999999999999" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.checkout_session_id).toBe(SESSION);
    expect(new URL(body.purchase_url).searchParams.get("email")).toBe(ADDRESS);
    expect(h.create).not.toHaveBeenCalled();
    expectNoLeak();
  });
});
