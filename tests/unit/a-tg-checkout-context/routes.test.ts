import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

// a-tg-checkout-context: the opener context lands in checkout_session_created metadata only,
// an unknown value is dropped, and the Whop redirect gets via=tg_webapp only with the flag on.
const h = vi.hoisted(() => ({
  log: vi.fn(), create: vi.fn(), resting: vi.fn(), flag: vi.fn(), plan: vi.fn(),
  handler: (() => ({})) as (c: unknown) => unknown,
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: h.log }));
vi.mock("@/lib/admin/flags", () => ({ flag: h.flag }));
vi.mock("@/lib/mentor/guard", () => ({ mentorResting: h.resting }));
vi.mock("@/lib/mentor/credits/plan-check", () => ({ checkMentorPlan: h.plan }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "66666666-6666-4666-8666-666666666666" }), isPaidAccess: () => false, forgetGuardUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => "k", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult).sb }));
vi.mock("@/lib/whop", async (orig) => ({ ...(await orig<typeof import("@/lib/whop")>()), tierToWhopPlan: (t: string) => `plan_${t}`, createWhopCheckoutSession: h.create }));

const U = "66666666-6666-4666-8666-666666666666";
const SESSION = "88888888-8888-4888-8888-888888888888";
const PACKAGES = [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null }];
const req = (path: string, body: unknown) => new NextRequest(`https://medpruf.com${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const created = () => h.log.mock.calls.map((c) => c[1]).find((e) => e.event === "checkout_session_created");
const redirected = () => h.log.mock.calls.map((c) => c[1]).find((e) => e.event === "checkout_redirected");

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  h.resting.mockResolvedValue(false); h.flag.mockResolvedValue(true); h.plan.mockResolvedValue({ ok: true });
  h.log.mockResolvedValue(undefined);
  h.create.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.com/checkout/ch_1", planId: "plan_b" });
  for (const [k, v] of Object.entries({ AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_PACKAGES_ENABLED: "true", WHOP_PLAN_MENTOR_BASIS: "plan_b", MENTOR_BETA_USER_IDS: U, NOTES_TRIAL_ENABLED: "true" })) vi.stubEnv(k, v);
  h.handler = (raw) => {
    const c = raw as FakeCall;
    if (c.table === "ai_credit_package") return { data: PACKAGES };
    if (c.table === "rpc:mentor_begin_purchase") return { data: { ok: true } };
    if (c.table === "ai_mentor_purchase") return { data: { checkout_session_id: SESSION } };
    if (c.table === "users") return { data: { id: U, tier: "free", role: "user", tier_expires_at: null, email: null } };
    if (c.table.startsWith("ai_") || c.table.startsWith("rpc:mentor")) return {};
    return { data: [] };
  };
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/whop/checkout", () => {
  const post = async (body: unknown) => (await import("@/app/api/whop/checkout/route")).POST(req("/api/whop/checkout", body));
  it("writes a valid context into checkout_session_created only", async () => {
    expect((await post({ tier: "first_month_19", context: "tg_webapp" })).status).toBe(200);
    expect(created().metadata).toEqual({ context: "tg_webapp" });
    expect(redirected().metadata).toBeUndefined();
    expect(h.create.mock.calls[0][0].redirectUrl).toBe("https://medpruf.com/checkout/success?tier=first_month_19");
  });
  it("drops an unknown or missing context (metadata stays as before)", async () => {
    await post({ tier: "first_month_19", context: "evil" });
    expect(created().metadata).toBeUndefined();
    vi.clearAllMocks(); h.log.mockResolvedValue(undefined); h.create.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.com/checkout/ch_1" });
    await post({ tier: "first_month_19" });
    expect(created().metadata).toBeUndefined();
  });
  it("flag on: Mini App openers return with via=tg_webapp, others unchanged", async () => {
    vi.stubEnv("TG_CHECKOUT_OPENLINK_ENABLED", "true");
    await post({ tier: "first_month_19", context: "tg_webapp" });
    expect(h.create.mock.calls[0][0].redirectUrl).toBe("https://medpruf.com/checkout/success?tier=first_month_19&via=tg_webapp");
    await post({ tier: "first_month_19", context: "browser" });
    expect(h.create.mock.calls[1][0].redirectUrl).toBe("https://medpruf.com/checkout/success?tier=first_month_19");
  });
});

describe("POST /api/whop/trial", () => {
  const post = async (body: unknown) => (await import("@/app/api/whop/trial/route")).POST(req("/api/whop/trial", body));
  it("context joins the trial flow metadata; an empty body still works", async () => {
    expect((await post({ context: "pwa" })).status).toBe(200);
    expect(created().metadata).toEqual({ flow: "notes_pro_trial", context: "pwa" });
    vi.clearAllMocks(); h.log.mockResolvedValue(undefined); h.create.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.com/checkout/ch_1" });
    expect((await post(undefined)).status).toBe(200);
    expect(created().metadata).toEqual({ flow: "notes_pro_trial" });
    expect(h.create.mock.calls[0][0].redirectUrl).toBe("https://medpruf.com/checkout/success?tier=notes_pro_trial&trial=1");
  });
  it("flag on: the Mini App hint is appended", async () => {
    vi.stubEnv("TG_CHECKOUT_OPENLINK_ENABLED", "true");
    await post({ context: "tg_webapp" });
    expect(h.create.mock.calls[0][0].redirectUrl).toBe("https://medpruf.com/checkout/success?tier=notes_pro_trial&trial=1&via=tg_webapp");
  });
});

describe("POST /api/mentor/checkout", () => {
  const post = async (body: unknown) => (await import("@/app/api/mentor/checkout/route")).POST(req("/api/mentor/checkout", body));
  it("context joins the mentor tag on checkout_session_created only", async () => {
    expect((await post({ package_id: "mentor_basis", idempotency_key: SESSION, context: "tg_inapp" })).status).toBe(200);
    expect(created().metadata).toEqual({ kind: "mentor_credits", package: "mentor_basis", context: "tg_inapp" });
    expect(redirected().metadata).toEqual({ kind: "mentor_credits", package: "mentor_basis" });
    expect(h.create.mock.calls[0][0].redirectUrl).not.toContain("via=");
  });
  it("an unknown context is dropped, never a 400", async () => {
    expect((await post({ package_id: "mentor_basis", idempotency_key: SESSION, context: 42 })).status).toBe(200);
    expect(created().metadata).toEqual({ kind: "mentor_credits", package: "mentor_basis" });
  });
  it("flag on: Mini App hint on the mentor return URL", async () => {
    vi.stubEnv("TG_CHECKOUT_OPENLINK_ENABLED", "true");
    await post({ package_id: "mentor_basis", idempotency_key: SESSION, context: "tg_webapp" });
    expect(h.create.mock.calls[0][0].redirectUrl).toBe(`https://medpruf.com/mentor/checkout/success?package=mentor_basis&checkout_session_id=${SESSION}&via=tg_webapp`);
  });
});
