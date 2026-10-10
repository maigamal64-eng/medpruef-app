/**
 * The real POST /api/webhooks/whop with the mentor branch wired in: a mentor
 * refund / deactivation for a user who ALSO holds active Pro must never reach
 * handleRevoke (no subscriptions/users write, no commit_whop_revoke), and a
 * Pro renewal still takes the Pro grant path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../../helpers/fake-supabase";

const h = vi.hoisted(() => ({ handler: (() => ({})) as (call: unknown) => unknown }));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => false }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c) => h.handler(c) as FakeResult | undefined);
    (globalThis as { __mentorCalls?: FakeCall[][] }).__mentorCalls!.push(calls);
    return sb;
  },
}));

import { POST } from "@/app/api/webhooks/whop/route";

const SECRET = "ws_test_secret";
const PRO_AND_MENTOR = "44444444-4444-4444-8444-444444444444";

function allCalls(): FakeCall[] {
  return ((globalThis as { __mentorCalls?: FakeCall[][] }).__mentorCalls ?? []).flat();
}

function deliver(action: string, data: unknown) {
  return POST(
    new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      headers: { "webhook-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    }),
  );
}

const proSub = {
  id: "sub_pro",
  user_id: PRO_AND_MENTOR,
  tier: "first_month_19",
  status: "active",
  expires_at: new Date(Date.now() + 20 * 86400_000).toISOString(),
  amount_cents: 1900,
  started_at: new Date(Date.now() - 10 * 86400_000).toISOString(),
  provider_payment_id: "pay_PRO",
  granted_payment_ids: [],
  whop_membership_id: "mem_PRO",
};

function handler(c: FakeCall): FakeResult | undefined {
  if (c.table === "rpc:mentor_whop_lookup") {
    const a = c.payload as { p_payment_id: string | null; p_membership_id: string | null };
    if (a.p_payment_id === "pay_MENTOR") return { data: { mentor: true, via: "payment", user_id: PRO_AND_MENTOR, package_id: "mentor_plus" } };
    if (a.p_membership_id === "mem_MENTOR") return { data: { mentor: true, via: "membership", user_id: PRO_AND_MENTOR, package_id: "mentor_plus" } };
    return { data: { mentor: false } };
  }
  if (c.table === "rpc:mentor_clawback") return { data: { ok: true, duplicate: false, lot_id: "lot-m", user_id: PRO_AND_MENTOR, clawed_micro: 1 } };
  if (c.table === "rpc:mentor_membership_status") return { data: { ok: true, user_id: PRO_AND_MENTOR } };
  if (c.table === "rpc:mentor_grant_credits") return { data: { ok: true, duplicate: false, lot_id: "lot-new", granted_micro: 2000000 } };
  // If anything reached the Pro revoke path it would find this active Pro sub.
  if (c.table === "subscriptions" && c.op === "select") return { data: [proSub] };
  if (c.table === "users" && c.op === "select") return { data: { id: eqVal(c, "id") ?? PRO_AND_MENTOR, email: "x@example.com", tier: "pro" } };
  if (c.table === "processed_webhook_events" && c.op === "insert") return { data: { event_id: "x" } };
  return {};
}

const proWrite = (c: FakeCall) =>
  (c.table === "subscriptions" && c.op !== "select") ||
  (c.table === "users" && c.op !== "select") ||
  c.table === "rpc:commit_whop_revoke" ||
  c.table === "processed_webhook_events";

beforeEach(() => {
  process.env.WHOP_WEBHOOK_SECRET = SECRET;
  process.env.WHOP_PLAN_MENTOR_PLUS = "plan_mplus";
  (globalThis as { __mentorCalls?: FakeCall[][] }).__mentorCalls = [];
  h.handler = handler as (call: unknown) => unknown;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_PLAN_MENTOR_PLUS;
});

describe("POST /api/webhooks/whop with the mentor branch", () => {
  const revokes: Array<[string, unknown]> = [
    ["refund.created", { id: "rfnd_1", payment_id: "pay_MENTOR" }],
    ["dispute.created", { id: "dspt_1", payment: { id: "pay_MENTOR" } }],
    ["refund.updated", { id: "rfnd_1", payment_id: "pay_MENTOR" }],
    ["payment.refunded", { id: "pay_MENTOR" }],
    ["membership.deactivated", { id: "mem_MENTOR" }],
    ["membership.cancelled", { id: "mem_MENTOR" }],
    ["membership.expired", { id: "mem_MENTOR" }],
  ];
  for (const [event, data] of revokes) {
    it(`${event} on the mentor package never cancels the buyer's active Pro`, async () => {
      const res = await deliver(event, data);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mentor).toBe(true);
      expect(allCalls().filter(proWrite)).toEqual([]);
    });
  }

  it("a mentor renewal (metadata null, mentor plan) grants credits and writes nothing on the Pro side", async () => {
    const res = await deliver("payment.succeeded", { id: "pay_REN", plan: { id: "plan_mplus" }, membership: { id: "mem_MENTOR" }, metadata: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mentor: true, action: "granted" });
    expect(allCalls().filter(proWrite)).toEqual([]);
  });

  it("a Pro refund still reaches the Pro revoke path", async () => {
    const res = await deliver("refund.created", { id: "rfnd_P", payment_id: "pay_PRO" });
    const body = await res.json();
    expect(body.mentor).toBeUndefined();
    expect(allCalls().some((c) => c.table === "rpc:mentor_whop_lookup")).toBe(true);
    expect(allCalls().some((c) => c.table === "subscriptions" && c.op === "select")).toBe(true);
  });

  it("with no mentor plan configured, a Pro delivery makes no mentor RPC at all", async () => {
    delete process.env.WHOP_PLAN_MENTOR_PLUS;
    await deliver("refund.created", { id: "rfnd_P", payment_id: "pay_PRO" });
    await deliver("membership.deactivated", { id: "mem_PRO" });
    expect(allCalls().some((c) => c.table.startsWith("rpc:mentor_"))).toBe(false);
  });
});
