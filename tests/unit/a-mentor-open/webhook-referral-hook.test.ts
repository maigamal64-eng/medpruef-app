import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as (call: unknown) => unknown,
  sendZohoEmail: vi.fn(),
  calls: [] as unknown[],
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.sendZohoEmail }));
vi.mock("@/lib/referral-exam-reward", () => ({
  qualifyReferralOnActivity: vi.fn(),
  isReferralExamRewardEnabled: () => true,
}));
const ref = vi.hoisted(() => ({ reward: vi.fn(async () => ({ status: "off" })), clawback: vi.fn(async () => ({ clawed: 0 })) }));
vi.mock("@/lib/referral-mentor-credits", () => ({ rewardReferrerOnFirstCharge: ref.reward, clawbackReferralMentorCredit: ref.clawback }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    // share the call log across every getServiceClient() instance
    const orig = sb.from;
    sb.from = (t: string) => {
      const b = orig(t) as Record<string, unknown>;
      const then = b.then as (...a: unknown[]) => unknown;
      void then;
      return b;
    };
    h.calls = calls;
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls ??= [];
    (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls!.push(calls);
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";

const SECRET = "ws_test_secret";
const MEZOO = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const PAYER_EMAIL_OWNER = "3e814abc-3c3f-4ef3-b55a-9f03b63a5841";


function deliver(action: string, data: unknown) {
  return POST(
    new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      headers: { "webhook-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    })
  );
}

const renewal = {
  id: "pay_redactedfd51769b",
  billing_reason: "subscription_cycle",
  plan: { id: "plan_trial" },
  user: { email: "payer@example.com" },
  membership: { id: "mem_redacted24a53b8f" },
  member: { id: "mber_bs3QbHTs49VWM" },
  metadata: null,
  checkout_configuration_id: "ch_S0bPNhu0eGZIBvL",
  amount_after_fees: 17.92,
  currency: "eur",
};

let claimed: Set<string>;

function baseHandler(extra?: (c: FakeCall) => FakeResult | undefined) {
  return (c: FakeCall): FakeResult | undefined => {
    const x = extra?.(c);
    if (x) return x;
    if (c.table === "processed_webhook_events" && c.op === "insert") {
      const id = (c.payload as { event_id: string }).event_id;
      if (claimed.has(id)) return { error: { code: "23505", message: "duplicate key" } };
      claimed.add(id);
      return { data: { event_id: id } };
    }
    if (c.table === "payment_events" && c.op === "select") {
      return eqVal(c, "checkout_session_id") === "ch_S0bPNhu0eGZIBvL"
        ? { data: [{ user_id: MEZOO }] }
        : { data: [] };
    }
    if (c.table === "users" && c.op === "select") {
      const id = eqVal(c, "id") as string | undefined;
      if (id === MEZOO) return { data: { id, email: "mezoo@example.com", first_name: "M", language_code: "de", tier: "pro", tier_expires_at: new Date(Date.now() + 86400_000).toISOString() } };
      if (id === PAYER_EMAIL_OWNER) return { data: { id } };
      if (c.filters.some((f) => f.kind === "ilike")) return { data: [{ id: PAYER_EMAIL_OWNER }] };
      return { data: null };
    }
    if (c.table === "subscriptions" && c.op === "select") return { data: [] };
    if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_new" } };
    return {};
  };
}

beforeEach(() => {
  process.env.WHOP_WEBHOOK_SECRET = SECRET;
  process.env.WHOP_PLAN_NOTES_TRIAL = "plan_trial";
  (globalThis as { __fakeCalls?: unknown[][] }).__fakeCalls = [];
  claimed = new Set();
  delete process.env.WHOP_ATOMIC_GRANTS_ENABLED;
  h.sendZohoEmail.mockReset();
  h.sendZohoEmail.mockResolvedValue({ ok: true });
  // The membership API is never needed when the checkout tie resolves; make
  // any call loud.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
  h.handler = baseHandler() as (call: unknown) => unknown;
  ref.reward.mockClear();
  ref.clawback.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_API_KEY;
  delete process.env.WHOP_ATOMIC_GRANTS_ENABLED;
});


describe("a-mentor-open: referral mentor credits hook in the Whop webhook", () => {
  it("the EUR 0 trial start never calls the reward", async () => {
    const res = await deliver("payment.succeeded", { ...renewal, id: "pay_TRIAL0", billing_reason: "subscription_create", amount_after_fees: 0, metadata: { medpruef_user_id: MEZOO, tier: "notes_pro_trial" } });
    expect((await res.json()).activated).toBe(true);
    expect(ref.reward).not.toHaveBeenCalled();
  });
  it("a paid charge (trial conversion) calls it once for the subscriber with the charged amount", async () => {
    const res = await deliver("payment.succeeded", renewal);
    expect((await res.json()).activated).toBe(true);
    expect(ref.reward).toHaveBeenCalledTimes(1);
    const [, args] = ref.reward.mock.calls[0] as unknown as [unknown, { refereeId: string; paymentId: string; amountCents: number; via: string }];
    expect(args).toMatchObject({ refereeId: MEZOO, paymentId: "pay_redactedfd51769b", via: "webhook" });
    expect(args.amountCents).toBeGreaterThan(0);
  });
  it("a refund or dispute asks for the clawback with the reversed payment; a cancellation does not", async () => {
    await deliver("refund.created", { id: "rfnd_1", payment: { id: "pay_redactedfd51769b" } });
    expect(ref.clawback).toHaveBeenCalledWith(expect.anything(), ["pay_redactedfd51769b", "pay_redactedfd51769b"], "refund.created");
    ref.clawback.mockClear();
    await deliver("membership.deactivated", { id: "mem_redacted24a53b8f" });
    expect(ref.clawback).not.toHaveBeenCalled();
  });
});
