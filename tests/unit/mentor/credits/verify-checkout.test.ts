import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  createSession: vi.fn(),
  flag: vi.fn(async () => true),
  log: vi.fn(async () => {}),
  handler: (() => ({})) as (c: unknown) => unknown,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: h.log }));
vi.mock("@/lib/admin/flags", () => ({ flag: h.flag }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 5, resetAt: 0, retryAfterSec: 0 }),
  rateKey: (a: string, b: string) => `${a}:${b}`,
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: "66666666-6666-4666-8666-666666666666", role: "user", tier: "free", tierExpiresAt: null }),
}));
vi.mock("@/lib/whop", async (orig) => ({ ...(await orig<typeof import("@/lib/whop")>()), createWhopCheckoutSession: h.createSession }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult | undefined).sb,
}));

import { createFakeSupabase, type FakeCall, type FakeResult } from "../../helpers/fake-supabase";
import { verifyMentorCheckout, type LedgerFn } from "@/lib/mentor/credits/verify";
import { resetPackageCache } from "@/lib/mentor/credits/packages";
import { POST as checkout } from "@/app/api/mentor/checkout/route";

const U = "66666666-6666-4666-8666-666666666666";
const NOW = Date.parse("2026-10-10T12:00:00Z");
const ENV = { WHOP_PLAN_MENTOR_BASIS: "plan_b", WHOP_PLAN_MENTOR_PLUS: "plan_p" };

function db(over: (c: FakeCall) => FakeResult | undefined = () => undefined) {
  return createFakeSupabase((c) => {
    const o = over(c);
    if (o) return o;
    if (c.table === "ai_credit_lot") return { data: [] };
    if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "l", granted_micro: 750000 } };
    return {};
  });
}

function ledger(memberships: unknown[], payments: unknown[], truncated = false): LedgerFn {
  return async (a) => ({ rows: a.endpoint === "memberships" ? (a.query.includes("plan_b") ? memberships : []) : payments, truncated });
}

const myMembership = { id: "mem_1", status: "active", metadata: { kind: "mentor_credits", medpruef_user_id: U } };
const paid = { id: "pay_1", status: "paid", plan: { id: "plan_b" }, membership: { id: "mem_1" }, created_at: new Date(NOW - 60_000).toISOString() };

describe("verifyMentorCheckout", () => {
  it("granted at once when a whop_payment lot landed recently", async () => {
    const { sb } = db((c) => (c.table === "ai_credit_lot" ? { data: [{ id: "l" }] } : undefined));
    expect(await verifyMentorCheckout({ db: sb as never, apiKey: null, companyId: null, env: ENV, now: () => NOW }, U, null)).toBe("granted");
  });

  it("finds the paid payment on this user's mentor membership and grants through the webhook's idempotent grant", async () => {
    const { sb, calls } = db();
    const s = await verifyMentorCheckout({ db: sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [paid]), now: () => NOW }, U, null);
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
    expect(await verifyMentorCheckout({ ...deps, apiKey: "k", ledger: ledger([other], [paid]) }, U, null)).toBe("pending");
    expect(await verifyMentorCheckout({ ...deps, apiKey: null }, U, null)).toBe("pending");
    expect(await verifyMentorCheckout({ ...deps, apiKey: "k", ledger: ledger([myMembership], [], true) }, U, null)).toBe("pending");
  });

  it("only a failed payment -> failed; a DB error on grant -> pending", async () => {
    const { sb } = db();
    const failedPay = { ...paid, status: "failed" };
    expect(await verifyMentorCheckout({ db: sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [failedPay]), now: () => NOW }, U, null)).toBe("failed");
    const e = db((c) => (c.table === "rpc:mentor_grant_credits" ? { data: { ok: false, reason: "db_error" } } : undefined));
    expect(await verifyMentorCheckout({ db: e.sb as never, apiKey: "k", companyId: "biz", env: ENV, ledger: ledger([myMembership], [paid]), now: () => NOW }, U, null)).toBe("pending");
  });
});

describe("POST /api/mentor/checkout", () => {
  const ON = {
    AI_FEATURES_ENABLED: "true",
    MENTOR_ENABLED: "true",
    MENTOR_PACKAGES_ENABLED: "true",
    WHOP_PLAN_MENTOR_BASIS: "plan_b",
  };
  const pkgRows = [{ package_id: "mentor_basis", kind: "subscription", grant_micro: 750000, period_days: 30, expiry_days: 33, price_eur_cents: 490, active: true, provisional: true, sort: 10, note: null }];

  function req(body: unknown) {
    return new NextRequest("https://medpruf.com/api/mentor/checkout", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  }

  beforeEach(() => {
    resetPackageCache();
    h.createSession.mockReset();
    h.createSession.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.com/checkout/plan_b/?session=ch_1", planId: "plan_b" });
    h.handler = (c: unknown) => ((c as FakeCall).table === "ai_credit_package" ? { data: pkgRows } : {});
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
    expect(await res.json()).toEqual({ purchase_url: "https://whop.com/checkout/plan_b/?session=ch_1" });
    const args = h.createSession.mock.calls[0][0] as { planId: string; metadata: Record<string, string>; redirectUrl: string };
    expect(args.planId).toBe("plan_b");
    expect(args.metadata).toEqual({ kind: "mentor_credits", package: "mentor_basis", medpruef_user_id: U });
    expect("tier" in args.metadata).toBe(false);
    expect(args.redirectUrl).toMatch(/\/mentor\/checkout\/success\?package=mentor_basis$/);
    expect(args.redirectUrl).not.toMatch(/\/checkout\/success\?tier/);
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
