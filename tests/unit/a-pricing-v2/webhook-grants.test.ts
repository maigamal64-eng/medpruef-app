import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

// a-pricing-v2: the Whop webhook grants the v2 plans by metadata tier or by
// their plan ids; the Sitting Pass ends the day after the chosen sitting
// (clamped, never open); 6 months grants 6 months per charge and the ticket
// exactly 12 months. Harness as tests/unit/api/whop-webhook.test.ts.
const h = vi.hoisted(() => ({ handler: (() => ({})) as (call: unknown) => unknown }));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => true }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls ??= [];
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls!.push(calls);
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";
import { whopPlanToTier, tierToWhopPlan } from "@/lib/whop";
import { useWhopV1Secret, whopSigned } from "../helpers/whop-signed";

const USER = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const DAY = 86_400_000;

const allCalls = (): FakeCall[] => ((globalThis as { __fakeCalls?: FakeCall[][] }).__fakeCalls ?? []).flat();
const deliver = (data: unknown) => POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
  method: "POST",
  ...whopSigned(JSON.stringify({ action: "payment.succeeded", data })),
}));
const payment = (id: string, metadata: Record<string, string> | null, plan = "plan_x", amount = 59) => ({
  id, plan: { id: plan }, user: { email: "buyer@example.com" }, membership: { id: "mem_TESTv2" },
  metadata, amount_after_fees: amount, currency: "eur",
});

let claimed: Set<string>;
beforeEach(() => {
  useWhopV1Secret();
  process.env.WHOP_PLAN_FLEX_MONTH = "plan_flex";
  process.env.WHOP_PLAN_SITTING_PASS = "plan_pass";
  process.env.WHOP_PLAN_HALF_YEAR = "plan_half";
  process.env.WHOP_PLAN_GUARANTEE_TICKET = "plan_ticket";
  delete process.env.WHOP_ATOMIC_GRANTS_ENABLED;
  (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls = [];
  claimed = new Set();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
  h.handler = ((c: FakeCall): FakeResult | undefined => {
    if (c.table === "processed_webhook_events" && c.op === "insert") {
      const id = (c.payload as { event_id: string }).event_id;
      if (claimed.has(id)) return { error: { code: "23505", message: "duplicate key" } };
      claimed.add(id);
      return { data: { event_id: id } };
    }
    if (c.table === "users" && c.op === "select") return { data: { id: USER, email: "buyer@example.com", tier: "free", tier_expires_at: null, role: "user" } };
    if (c.table === "subscriptions" && c.op === "select") return { data: [] };
    if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_new" } };
    if (c.table === "payment_events" && c.op === "select") return { data: [] };
    if (c.table.startsWith("rpc:grant_whop_paid_subscription")) return { data: [{ mode: "inserted", subscription_id: "sub_rpc", expires_at: new Date(Date.now() + 40 * DAY).toISOString(), previous_expires_at: null, replayed: false, entitlement_reconciled: true }] };
    return {};
  }) as (call: unknown) => unknown;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["WHOP_PLAN_FLEX_MONTH", "WHOP_PLAN_SITTING_PASS", "WHOP_PLAN_HALF_YEAR", "WHOP_PLAN_GUARANTEE_TICKET", "WHOP_ATOMIC_GRANTS_ENABLED"]) delete process.env[k];
});

const inserted = () => allCalls().find((c) => c.table === "subscriptions" && c.op === "insert")!.payload as {
  tier: string; expires_at: string; granted_payment_ids: Array<{ added_months: number; ends_at?: string }>;
};

describe("v2 plan ids map both ways", () => {
  it("whopPlanToTier and tierToWhopPlan know the four new plans", () => {
    expect(["plan_flex", "plan_pass", "plan_half", "plan_ticket"].map(whopPlanToTier)).toEqual(["flex_month", "sitting_pass", "half_year", "guarantee_ticket"]);
    expect(tierToWhopPlan("guarantee_ticket")).toBe("plan_ticket");
  });
});

describe("POST /api/webhooks/whop: v2 grants (fallback path)", () => {
  it("Sitting Pass: access ends the day after the chosen sitting, recorded with its exact end", async () => {
    const lastDay = new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
    const res = await deliver(payment("pay_PASS1", { medpruef_user_id: USER, tier: "sitting_pass", sitting_last_day: lastDay }));
    expect((await res.json()).activated).toBe(true);
    const sub = inserted();
    expect(sub.tier).toBe("sitting_pass");
    const end = Date.parse(sub.expires_at);
    expect(end).toBeGreaterThan(Date.now() + 60 * DAY);
    expect(end).toBeLessThan(Date.now() + 63 * DAY);
    expect(sub.granted_payment_ids[0].added_months).toBe(3);
    expect(sub.granted_payment_ids[0].ends_at).toBe(sub.expires_at);
  });

  it("Sitting Pass without a readable sitting: the 3-month maximum, never an open end", async () => {
    await deliver(payment("pay_PASS2", { medpruef_user_id: USER, tier: "sitting_pass", sitting_last_day: "garbage" }));
    const end = Date.parse(inserted().expires_at);
    expect(end).toBeGreaterThan(Date.now() + 88 * DAY);
    expect(end).toBeLessThan(Date.now() + 93 * DAY);
  });

  it("6 months by plan id on a renewal without metadata: 6 months per charge", async () => {
    await deliver(payment("pay_HALF1", { medpruef_user_id: USER }, "plan_half", 100));
    const sub = inserted();
    expect(sub.tier).toBe("half_year");
    expect(sub.granted_payment_ids[0].added_months).toBe(6);
    const end = Date.parse(sub.expires_at);
    expect(end).toBeGreaterThan(Date.now() + 180 * DAY);
    expect(end).toBeLessThan(Date.now() + 185 * DAY);
  });

  it("Guarantee Ticket: exactly 12 months with an end date", async () => {
    await deliver(payment("pay_TICKET1", { medpruef_user_id: USER, tier: "guarantee_ticket" }, "plan_ticket", 179));
    const sub = inserted();
    expect(sub.tier).toBe("guarantee_ticket");
    expect(sub.granted_payment_ids[0].added_months).toBe(12);
    const expected = new Date(); expected.setUTCMonth(expected.getUTCMonth() + 12);
    expect(Math.abs(Date.parse(sub.expires_at) - expected.getTime())).toBeLessThan(60_000);
  });

  it("Monthly 24: one month per charge", async () => {
    await deliver(payment("pay_FLEX1", { medpruef_user_id: USER, tier: "flex_month" }, "plan_flex", 24));
    expect(inserted().granted_payment_ids[0].added_months).toBe(1);
  });
});

describe("POST /api/webhooks/whop: v2 grants (atomic path)", () => {
  it("the Sitting Pass goes through the exact-end function; other plans keep the months function", async () => {
    process.env.WHOP_ATOMIC_GRANTS_ENABLED = "true";
    const lastDay = new Date(Date.now() + 45 * DAY).toISOString().slice(0, 10);
    await deliver(payment("pay_PASS3", { medpruef_user_id: USER, tier: "sitting_pass", sitting_last_day: lastDay }));
    const until = allCalls().find((c) => c.table === "rpc:grant_whop_paid_subscription_until");
    expect(until).toBeTruthy();
    const args = until!.payload as { p_expires_at: string; p_added_months: number; p_tier: string };
    expect(args.p_tier).toBe("sitting_pass");
    expect(args.p_added_months).toBe(2);
    expect(Date.parse(args.p_expires_at)).toBeGreaterThan(Date.now() + 45 * DAY);
    await deliver(payment("pay_TICKET2", { medpruef_user_id: USER, tier: "guarantee_ticket" }, "plan_ticket", 179));
    const months = allCalls().find((c) => c.table === "rpc:grant_whop_paid_subscription_pinned");
    expect((months!.payload as { p_duration_months: number }).p_duration_months).toBe(12);
  });
});
