/**
 * a-pricing-v2-fit, decision returning-payer-price (D-A): eligibility comes
 * from a succeeded Whop payment; the old 19 and 49 recurring plans are
 * offered only to eligible signed-in learners and checkout sells them only
 * after a server-side check. Never the retired Cohort; never while the
 * switch or the v2 offer is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), create: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, forgetGuardUser: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: m.log }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/whop", async (orig) => ({ ...(await orig<typeof import("@/lib/whop")>()), tierToWhopPlan: (t: string) => `plan_${t}`, createWhopCheckoutSession: m.create }));

import { POST as checkout } from "@/app/api/whop/checkout/route";
import { GET as returningGet } from "@/app/api/pricing/returning/route";
import { hasSucceededWhopPayment, returningPricesEnabled } from "@/lib/pricing-v2/returning-payer";

const free = { tier: "free", role: "user", tier_expires_at: null, email: "a@example.com" };
const paidBefore = [{ status: "cancelled", amount_cents: 1900, granted_payment_ids: [{ payment_id: "pay_1", amount_cents: 1900 }] }];
const req = (body: unknown) => new NextRequest("https://medpruf.com/api/whop/checkout", { method: "POST", body: JSON.stringify(body) });
const getReq = () => new NextRequest("https://medpruf.com/api/pricing/returning");

function db(subs: unknown[] | { error: unknown }, calls: FakeCall[] = []) {
  return createFakeSupabase((c: FakeCall): FakeResult => {
    calls.push(c);
    if (c.table === "users") return { data: free };
    if (c.table === "subscriptions") return Array.isArray(subs) ? { data: subs } : { error: subs.error as never };
    return { data: [] };
  }).sb;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ userId: "u1" });
  m.log.mockResolvedValue(undefined);
  m.create.mockResolvedValue({ id: "ch_1", purchaseUrl: "https://whop.example/c" });
});
afterEach(() => vi.unstubAllEnvs());

describe("eligibility", () => {
  it("a succeeded, not reversed Whop payment; never a EUR 0 trial or an all-refunded history", () => {
    expect(hasSucceededWhopPayment(paidBefore)).toBe(true);
    expect(hasSucceededWhopPayment([{ status: "active", amount_cents: 0, granted_payment_ids: [{ amount_cents: 1900 }] }])).toBe(true);
    expect(hasSucceededWhopPayment([{ status: "active", amount_cents: 0, granted_payment_ids: [{ amount_cents: 0, added_months: 0 }] }])).toBe(false);
    expect(hasSucceededWhopPayment([{ status: "refunded", amount_cents: 4900, granted_payment_ids: [{ amount_cents: 4900 }] }])).toBe(false);
    expect(hasSucceededWhopPayment([{ status: "chargeback", amount_cents: 1900, granted_payment_ids: null }])).toBe(false);
    expect(hasSucceededWhopPayment([])).toBe(false);
  });

  it("the switch needs the v2 offer and RETURNING_PAYER_PRICES_ENABLED", () => {
    expect(returningPricesEnabled({})).toBe(false);
    expect(returningPricesEnabled({ RETURNING_PAYER_PRICES_ENABLED: "true" })).toBe(false);
    expect(returningPricesEnabled({ PRICING_V2_ENABLED: "true" })).toBe(false);
    expect(returningPricesEnabled({ PRICING_V2_ENABLED: "true", RETURNING_PAYER_PRICES_ENABLED: "true" })).toBe(true);
  });
});

describe("GET /api/pricing/returning", () => {
  it("off: false without a database read", async () => {
    const calls: FakeCall[] = [];
    m.client.mockReturnValue(db(paidBefore, calls));
    expect(await (await returningGet(getReq())).json()).toEqual({ eligible: false, tiers: [] });
    expect(calls).toHaveLength(0);
  });

  it("on: the caller's own Whop rows decide; a failed read is a 500, never true", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    vi.stubEnv("RETURNING_PAYER_PRICES_ENABLED", "true");
    const calls: FakeCall[] = [];
    m.client.mockReturnValue(db(paidBefore, calls));
    const res = await returningGet(getReq());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ eligible: true, tiers: ["first_month_19", "first_3mo_27"] });
    expect(calls[0].filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "user_id", value: "u1" }, { kind: "eq", column: "payment_provider", value: "whop" }]));
    m.client.mockReturnValue(db([]));
    expect(await (await returningGet(getReq())).json()).toEqual({ eligible: false, tiers: [] });
    m.client.mockReturnValue(db({ error: { code: "XX000", message: "boom" } }));
    expect((await returningGet(getReq())).status).toBe(500);
  });
});

describe("POST /api/whop/checkout: the old recurring plans under v2", () => {
  it("switch off: refused like any retired tier", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    m.client.mockReturnValue(db(paidBefore));
    expect((await checkout(req({ tier: "first_month_19" }))).status).toBe(400);
    expect(m.log.mock.calls.at(-1)?.[1]).toMatchObject({ reason: "not_returning_payer" });
  });

  it("switch on: an eligible learner buys 19 and 49; others are refused; the Cohort never sells", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    vi.stubEnv("RETURNING_PAYER_PRICES_ENABLED", "true");
    m.client.mockReturnValue(db(paidBefore));
    for (const tier of ["first_month_19", "first_3mo_27"]) {
      const r = await checkout(req({ tier }));
      expect(r.status).toBe(200);
    }
    expect(m.create.mock.calls.map((c) => c[0].metadata.tier)).toEqual(["first_month_19", "first_3mo_27"]);
    expect((await checkout(req({ tier: "premium_pass_guaranteed" }))).status).toBe(400);

    m.create.mockClear();
    m.client.mockReturnValue(db([{ status: "refunded", amount_cents: 1900, granted_payment_ids: [] }]));
    expect((await checkout(req({ tier: "first_month_19" }))).status).toBe(400);
    m.client.mockReturnValue(db([]));
    expect((await checkout(req({ tier: "first_3mo_27" }))).status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("a failed eligibility read is a 503 with Retry-After, never a sale", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
    vi.stubEnv("RETURNING_PAYER_PRICES_ENABLED", "true");
    m.client.mockReturnValue(db({ error: { code: "XX000", message: "boom" } }));
    const r = await checkout(req({ tier: "first_month_19" }));
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("15");
    expect(m.create).not.toHaveBeenCalled();
  });

  it("flag off (today's offer): the old plans sell to everyone as before, no eligibility read", async () => {
    const calls: FakeCall[] = [];
    m.client.mockReturnValue(db([], calls));
    expect((await checkout(req({ tier: "first_month_19" }))).status).toBe(200);
    expect(calls.some((c) => c.table === "subscriptions" && c.columns === "status, amount_cents, granted_payment_ids")).toBe(false);
  });
});
