import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  createSession: vi.fn(),
  flag: vi.fn(async () => true),
  log: vi.fn(async () => {}),
  handler: (() => ({})) as (c: unknown) => unknown,
  resting: vi.fn(async () => false as boolean | null),
  plan: vi.fn(async () => ({ ok: true }) as { ok: boolean; reason?: string }),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: h.log }));
vi.mock("@/lib/mentor/credits/plan-check", async (orig) => ({
  ...(await orig<typeof import("@/lib/mentor/credits/plan-check")>()),
  checkMentorPlan: (...a: unknown[]) => h.plan(...(a as [])),
}));
vi.mock("@/lib/mentor/guard", () => ({ mentorResting: h.resting }));
vi.mock("@/lib/admin/flags", () => ({ flag: h.flag }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 5, resetAt: 0, retryAfterSec: 0 }),
  rateKey: (a: string, b: string) => `${a}:${b}`,
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "66666666-6666-4666-8666-666666666666", role: "user", tier: "free", tierExpiresAt: null }),
  isPaidAccess: () => false,
}));
vi.mock("@/lib/whop", async (orig) => ({ ...(await orig<typeof import("@/lib/whop")>()), createWhopCheckoutSession: h.createSession }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult | undefined).sb,
}));

import { createFakeSupabase, type FakeCall, type FakeResult } from "../../helpers/fake-supabase";
import { looksRefunded, verifyMentorCheckout, type LedgerFn } from "@/lib/mentor/credits/verify";
import { resetPackageCache } from "@/lib/mentor/credits/packages";
import { POST as checkout } from "@/app/api/mentor/checkout/route";

const U = "66666666-6666-4666-8666-666666666666";
const SESSION = "88888888-8888-4888-8888-888888888888";
const NOW = Date.parse("2026-10-10T12:00:00Z");
const ENV = { WHOP_PLAN_MENTOR_BASIS: "plan_b", WHOP_PLAN_MENTOR_PLUS: "plan_p" };

const PURCHASE = { checkout_session_id: SESSION, whop_checkout_session_id: "ch_1", user_id: U, package_id: "mentor_basis", created_at: new Date(NOW - 120_000).toISOString(), expires_at: new Date(NOW + 86400000).toISOString(), status: "pending", payment_id: null, lot_id: null, granted_micro: null };

const PKG_ROWS = [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null }];

function db(over: (c: FakeCall) => FakeResult | undefined = () => undefined) {
  resetPackageCache();
  return createFakeSupabase((c) => {
    const o = over(c);
    if (o) return o;
    if (c.table === "ai_credit_package") return { data: PKG_ROWS };
    if (c.table === "ai_mentor_purchase") return { data: c.op === "select" ? PURCHASE : { checkout_session_id: SESSION } };
    if (c.table === "ai_credit_lot") return { data: [] };
    if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "l", granted_micro: 750000 } };
    return {};
  });
}

function ledger(memberships: unknown[], payments: unknown[], truncated = false): LedgerFn {
  return async (a) => ({ rows: a.endpoint === "memberships" ? (a.query.includes("plan_b") ? memberships : []) : payments, truncated });
}

const myMembership = { id: "mem_1", status: "active", metadata: { kind: "mentor_credits", medpruef_user_id: U, checkout_session_id: SESSION } };
const paid = { id: "pay_1", status: "paid", plan: { id: "plan_b" }, membership: { id: "mem_1" }, created_at: new Date(NOW - 60_000).toISOString(), final_amount: 4.9, currency: "eur" };

describe("verifyMentorCheckout", () => {
  it("granted only when this purchase is linked to its payment lot", async () => {
    const { sb } = db((c) => c.table === "ai_mentor_purchase" ? { data: { ...PURCHASE, status: "granted", payment_id: "pay_1", lot_id: "l", granted_micro: 750000 } } : c.table === "ai_credit_lot" ? { data: [{ id: "l" }] } : undefined);
    expect(await verifyMentorCheckout({ db: sb as never, apiKey: null, companyId: null, env: ENV, now: () => NOW }, U, null, SESSION)).toBe("granted");
  });

  it("finds the paid payment on this user's mentor membership and grants through the webhook's idempotent grant", async () => {
    const { sb, calls } = db();
    const s = await verifyMentorCheckout({ db: sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [paid]), now: () => NOW }, U, null, SESSION);
    expect(s).toBe("granted");
    expect(calls.find((c) => c.table === "rpc:mentor_grant_credits")!.payload).toMatchObject({
      p_user: U,
      p_package: "mentor_basis",
      p_source: "whop_payment",
      p_source_id: "pay_1",
      p_whop_membership_id: "mem_1",
    });
  });

  it("another user's membership, no API key, or a truncated scan -> pending, never failed", async () => {
    const other = { ...myMembership, metadata: { medpruef_user_id: "77777777-7777-4777-8777-777777777777" } };
    const { sb } = db();
    const deps = { db: sb as never, companyId: "biz", env: ENV, now: () => NOW };
    expect(await verifyMentorCheckout({ ...deps, apiKey: "k", ledger: ledger([other], [paid]) }, U, null, SESSION)).toBe("pending");
    expect(await verifyMentorCheckout({ ...deps, apiKey: null }, U, null, SESSION)).toBe("pending");
    expect(await verifyMentorCheckout({ ...deps, apiKey: "k", ledger: ledger([myMembership], [], true) }, U, null, SESSION)).toBe("pending");
  });

  it("H3: a paid row of EUR 0 or a refunded row never grants (failed, no grant RPC)", async () => {
    for (const row of [
      { ...paid, final_amount: 0, amount: 0 },
      { ...paid, status: "refunded" },
      { ...paid, refunded_amount: 4.9 },
      { ...paid, substatus: "partially_refunded" },
    ]) {
      const { sb, calls } = db();
      const s = await verifyMentorCheckout({ db: sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [row]), now: () => NOW }, U, null, SESSION);
      expect(s, JSON.stringify(row)).toBe("failed");
      expect(calls.filter((c) => c.table === "rpc:mentor_grant_credits"), JSON.stringify(row)).toHaveLength(0);
    }
  });

  it("H1: a payment the ledger refuses as revoked is reported failed, not granted", async () => {
    const { sb } = db((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "revoked" } } : undefined));
    expect(await verifyMentorCheckout({ db: sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [paid]), now: () => NOW }, U, null, SESSION)).toBe("failed");
  });

  it("looksRefunded reads every plausible refund signal", () => {
    expect(looksRefunded({ status: "paid" })).toBe(false);
    expect(looksRefunded({ status: "paid", refunded_amount: 0 })).toBe(false);
    expect(looksRefunded({ status: "refunded" })).toBe(true);
    expect(looksRefunded({ status: "paid", substatus: "chargeback" })).toBe(true);
    expect(looksRefunded({ status: "paid", amount_refunded: "1.5" })).toBe(true);
    expect(looksRefunded({ status: "paid", refunded_at: "2026-10-10T00:00:00Z" })).toBe(true);
  });

  it("only a failed payment -> failed; a DB error on grant -> pending", async () => {
    const { sb } = db();
    const failedPay = { ...paid, status: "failed" };
    expect(await verifyMentorCheckout({ db: sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [failedPay]), now: () => NOW }, U, null, SESSION)).toBe("failed");
    const e = db((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "db_error" } } : undefined));
    expect(await verifyMentorCheckout({ db: e.sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [paid]), now: () => NOW }, U, null, SESSION)).toBe("pending");
  });
});

describe("POST /api/mentor/checkout", () => {
  const ON = {
    AI_FEATURES_ENABLED: "true",
    MENTOR_ENABLED: "true",
    MENTOR_PACKAGES_ENABLED: "true",
    WHOP_PLAN_MENTOR_BASIS: "plan_b",
    // An empty allowlist admits nobody: the buyer is on it.
    MENTOR_BETA_USER_IDS: "66666666-6666-4666-8666-666666666666",
  };
  const pkgRows = [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null }];

  function req(body: unknown) {
    return new NextRequest("https://medpruf.com/api/mentor/checkout", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  }

  beforeEach(() => {
    resetPackageCache();
    h.createSession.mockReset();
    h.plan.mockReset();
    h.plan.mockResolvedValue({ ok: true });
    h.createSession.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.com/checkout/plan_b/?session=ch_1", planId: "plan_b" });
    h.resting.mockResolvedValue(false);
    h.handler = (c: unknown) => {
      const call = c as FakeCall;
      if (call.table === "ai_credit_package") return { data: pkgRows };
      if (call.table === "rpc:mentor_begin_purchase") return { data: { ok: true } };
      if (call.table === "ai_mentor_purchase") return { data: { checkout_session_id: SESSION } };
      return {};
    };
  });
  afterEach(() => {
    for (const k of [...Object.keys(ON), "MENTOR_BETA_USER_IDS"]) delete process.env[k];
  });

  it("403 mentor_disabled while the flags are off (default)", async () => {
    const res = await checkout(req({ package_id: "mentor_basis" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "mentor_disabled" });
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it("creates a session with mentor metadata (no tier key) and the mentor success page", async () => {
    Object.assign(process.env, ON);
    const res = await checkout(req({ package_id: "mentor_basis" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purchase_url: "https://whop.com/checkout/plan_b/?session=ch_1", checkout_session_id: expect.any(String) });
    const args = h.createSession.mock.calls[0][0] as { planId: string; metadata: Record<string, string>; redirectUrl: string };
    expect(args.planId).toBe("plan_b");
    expect(args.metadata).toEqual({ kind: "mentor_credits", package: "mentor_basis", medpruef_user_id: U, checkout_session_id: expect.any(String) });
    expect("tier" in args.metadata).toBe(false);
    expect(args.redirectUrl).toContain(`/mentor/checkout/success?package=mentor_basis&checkout_session_id=${args.metadata.checkout_session_id}`);
    expect(args.redirectUrl).not.toMatch(/\/checkout\/success\?tier/);
  });

  it("M3: a Whop plan that differs from the package row refuses checkout with 503 and creates no session", async () => {
    Object.assign(process.env, ON);
    h.plan.mockResolvedValue({ ok: false, reason: "initial_price" });
    const res = await checkout(req({ package_id: "mentor_basis" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "upstream_error" });
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.plan).toHaveBeenCalledWith(expect.objectContaining({ planId: "plan_b", priceCents: 490, kind: "subscription" }));
    expect(h.log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event: "checkout_failed", metadata: expect.objectContaining({ cause: "plan_initial_price" }) }));
  });

  it("rejects an unknown or unbuyable package", async () => {
    Object.assign(process.env, ON);
    expect((await checkout(req({ package_id: "first_month_19" }))).status).toBe(400);
    expect((await checkout(req({ package_id: "mentor_plus" }))).status).toBe(403); // no row / no plan
  });

  it("the DB flag off or a beta allowlist without the user blocks checkout", async () => {
    Object.assign(process.env, ON);
    h.flag.mockResolvedValueOnce(false);
    expect((await checkout(req({ package_id: "mentor_basis" }))).status).toBe(403);
    process.env.MENTOR_BETA_USER_IDS = "88888888-8888-4888-8888-888888888888";
    expect((await checkout(req({ package_id: "mentor_basis" }))).status).toBe(403);
  });
});
