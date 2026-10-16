import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase } from "../helpers/fake-supabase";

// a-renew-early: POST /api/whop/checkout decides extend vs switch vs refuse.
const mocks = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), create: vi.fn(), log: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: mocks.guard }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: mocks.client }));
vi.mock("@/lib/whop", () => ({
  tierToWhopPlan: () => "plan_fixture",
  createWhopCheckoutSession: mocks.create,
  TIERS: { first_month_19: { priceCents: 1900 }, first_3mo_27: { priceCents: 4900 }, premium_pass_guaranteed: { priceCents: 12900 } },
}));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: mocks.log }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/whop-subscription-snapshot", async (orig) => ({
  ...(await orig<typeof import("@/lib/whop-subscription-snapshot")>()),
  loadWhopBillingSnapshot: mocks.snapshot,
  loadWhopBillingRead: async (id: string | null, tier: string) => ({ snapshot: await mocks.snapshot(id, tier), status: 200 }),
}));
import { POST } from "@/app/api/whop/checkout/route";

const DAY = 86_400_000;
const post = (tier: string) => POST(new NextRequest("https://medpruf.com/api/whop/checkout", { method: "POST", body: JSON.stringify({ tier }) }));
const renewing = { provider_state_verified: true, billing_cadence: "auto_renews", cancel_at_period_end: false, provider_status: "active" };
const MONTHLY_PLAN = "plan_redacted8f2b848b"; // the 19 EUR monthly plan (billing-cadence)

function account(end: string, whopRows: Array<{ expires_at: string | null; whop_membership_id: string | null }>, activeRows: unknown[]) {
  return createFakeSupabase((call) => {
    if (call.table === "users") return { data: { tier: "pro", role: "user", tier_expires_at: end, email: null } };
    if (call.table === "subscriptions" && call.columns === "expires_at, whop_membership_id") return { data: whopRows };
    if (call.table === "subscriptions") return { data: activeRows };
    if (call.table === "payment_events" && call.columns?.includes("plan_id")) return { data: [{ payment_id: "pay_m", plan_id: MONTHLY_PLAN }, { payment_id: "pay_c", plan_id: "plan_redacted324decbc" }] };
    return { data: [] };
  });
}
const monthlyRow = { tier: "first_month_19", payment_provider: "whop", provider_payment_id: "pay_m", whop_membership_id: "mem_OLD1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: "user-1" });
  mocks.log.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ id: "ch_new", purchaseUrl: "https://whop.example/checkout" });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("renew early and switch (checkout)", () => {
  it("a plan that still renews: ALREADY_RENEWING without the switch flag (E2 not done)", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const end = new Date(Date.now() + 9 * DAY).toISOString();
    mocks.snapshot.mockResolvedValue({ ...renewing, next_charge_at: end });
    mocks.client.mockReturnValue(account(end, [{ expires_at: end, whop_membership_id: "mem_OLD1" }], [monthlyRow]).sb);
    const res = await post("premium_pass_guaranteed");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "ALREADY_RENEWING" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("with the switch flag: a strictly longer plan starts at the old end and carries the old membership", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    vi.stubEnv("WHOP_SWITCH_CANCEL_ENABLED", "true");
    const end = new Date(Date.now() + 9 * DAY).toISOString();
    mocks.snapshot.mockResolvedValue({ ...renewing, next_charge_at: end });
    mocks.client.mockReturnValue(account(end, [{ expires_at: end, whop_membership_id: "mem_OLD1" }], [monthlyRow]).sb);
    const res = await post("premium_pass_guaranteed");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ extendsFrom: end, switchFrom: true });
    const session = mocks.create.mock.calls[0][0];
    expect(session.metadata).toMatchObject({ medpruef_user_id: "user-1", tier: "premium_pass_guaranteed", switch_from_membership: "mem_OLD1" });
    const created = mocks.log.mock.calls.map((c) => c[1]).find((e) => e.event === "checkout_session_created");
    expect(created.metadata).toMatchObject({ extension: true, switch_from_membership: "mem_OLD1" });
  });
  it("with the switch flag: the same length is not a switch", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    vi.stubEnv("WHOP_SWITCH_CANCEL_ENABLED", "true");
    const end = new Date(Date.now() + 9 * DAY).toISOString();
    mocks.snapshot.mockResolvedValue({ ...renewing, next_charge_at: end });
    mocks.client.mockReturnValue(account(end, [{ expires_at: end, whop_membership_id: "mem_OLD1" }], [monthlyRow]).sb);
    expect(await (await post("first_month_19")).json()).toMatchObject({ code: "ALREADY_RENEWING" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("a plan already cancelled at Whop renews early from its end (no stop needed)", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const end = new Date(Date.now() + 4 * DAY).toISOString();
    mocks.snapshot.mockResolvedValue({ ...renewing, cancel_at_period_end: true, provider_status: "canceling", next_charge_at: null });
    mocks.client.mockReturnValue(account(end, [{ expires_at: end, whop_membership_id: "mem_OLD1" }], [monthlyRow]).sb);
    const res = await post("first_3mo_27");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ extendsFrom: end, switchFrom: false });
    expect(mocks.create.mock.calls[0][0].metadata.switch_from_membership).toBeUndefined();
  });
  it("comp or manual access outlasting the Whop row stays non-extendable", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    vi.stubEnv("WHOP_SWITCH_CANCEL_ENABLED", "true");
    const end = new Date(Date.now() + 30 * DAY).toISOString();
    const whopEnd = new Date(Date.now() + 3 * DAY).toISOString();
    mocks.snapshot.mockResolvedValue({ ...renewing, cancel_at_period_end: true, provider_status: "canceling", next_charge_at: null });
    mocks.client.mockReturnValue(account(end, [{ expires_at: whopEnd, whop_membership_id: "mem_OLD1" }], [monthlyRow, { tier: "pro", payment_provider: "manual", provider_payment_id: null, whop_membership_id: null }]).sb);
    expect(await (await post("first_3mo_27")).json()).toMatchObject({ code: "EXTENSION_UNAVAILABLE" });
    // Comp only: no Whop row at all.
    mocks.client.mockReturnValue(account(end, [], [{ tier: "pro", payment_provider: "manual", provider_payment_id: null, whop_membership_id: null }]).sb);
    expect(await (await post("first_3mo_27")).json()).toMatchObject({ code: "EXTENSION_UNAVAILABLE" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("an unpinned Whop row is never offered (it would be merged into)", async () => {
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    const end = new Date(Date.now() + 4 * DAY).toISOString();
    mocks.client.mockReturnValue(account(end, [{ expires_at: end, whop_membership_id: null }], [{ tier: "premium_pass_guaranteed", payment_provider: "whop", provider_payment_id: "pay_c", whop_membership_id: null }]).sb);
    expect(await (await post("first_month_19")).json()).toMatchObject({ code: "EXTENSION_UNAVAILABLE" });
  });
});
