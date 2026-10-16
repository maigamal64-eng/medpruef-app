/**
 * a-whop-webhook-ack (G3): Whop gets its 2xx once the claim and the grant are
 * written. Referral qualification, the ad conversion and the dunning mail run
 * after the response (captured here instead of run).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { useWhopV1Secret, whopSigned } from "../helpers/whop-signed";

const h = vi.hoisted(() => ({
  handler: (() => ({})) as (call: unknown) => unknown,
  deferred: [] as Array<{ label: string; task: () => Promise<void> }>,
  capi: vi.fn(),
  zoho: vi.fn(),
  qualify: vi.fn(),
}));
vi.mock("@/lib/after-response", () => ({
  afterResponse: async (label: string, task: () => Promise<void>) => { h.deferred.push({ label, task }); },
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: h.capi }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: h.zoho }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: h.qualify, isReferralExamRewardEnabled: () => true }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult | undefined).sb,
}));

import { POST } from "@/app/api/webhooks/whop/route";

const LEARNER = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const claims = new Map<string, Record<string, unknown>>();

function handler(c: FakeCall): FakeResult | undefined {
  if (c.table === "processed_webhook_events") {
    const id = (eqVal(c, "event_id") as string | undefined) ?? (c.payload as { event_id?: string } | undefined)?.event_id;
    if (c.op === "insert") {
      const row = c.payload as { event_id: string; payload: Record<string, unknown> };
      if (claims.has(row.event_id)) return { error: { code: "23505", message: "duplicate key" } };
      claims.set(row.event_id, row.payload);
      return { data: { event_id: row.event_id } };
    }
    if (c.op === "select") return { data: id && claims.has(id) ? { payload: claims.get(id) } : null };
    if (c.op === "update" && id) {
      claims.set(id, (c.payload as { payload: Record<string, unknown> }).payload);
      return { data: [{ event_id: id }] };
    }
  }
  if (c.table === "subscriptions" && c.op === "select") return { data: [] };
  if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_new" } };
  if (c.table === "users" && c.op === "select") {
    return { data: { id: LEARNER, email: "l@example.com", first_name: "A", language_code: "de", tier: "free", tier_expires_at: null, role: "user" } };
  }
  return {};
}

const deliver = (type: string, data: unknown) => POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
  method: "POST", ...whopSigned(JSON.stringify({ type, data })),
}));

beforeEach(() => {
  useWhopV1Secret();
  process.env.WHOP_PLAN_FIRST_MONTH_19 = "plan_month";
  claims.clear();
  h.deferred = [];
  h.capi.mockReset();
  h.zoho.mockReset();
  h.zoho.mockResolvedValue({ ok: true });
  h.qualify.mockReset();
  h.handler = handler as (call: unknown) => unknown;
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected network call"); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOP_PLAN_FIRST_MONTH_19;
});

describe("work after Whop's 2xx", () => {
  it("payment.succeeded answers 200 after the grant; referral and CAPI wait for the response", async () => {
    const res = await deliver("payment.succeeded", {
      id: "pay_FAST1", plan: { id: "plan_month" }, membership: { id: "mem_FAST1" },
      metadata: { medpruef_user_id: LEARNER, tier: "first_month_19" }, user: { email: "l@example.com" },
      amount_after_fees: 17.72, currency: "eur",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activated: true });
    expect(h.capi).not.toHaveBeenCalled();
    expect(h.qualify).not.toHaveBeenCalled();
    expect(h.deferred.map((d) => d.label)).toEqual(expect.arrayContaining(["whop-referral-qualify", "whop-reddit-capi"]));
    for (const d of h.deferred) await d.task();
    expect(h.capi).toHaveBeenCalledTimes(1);
    expect(h.qualify).toHaveBeenCalledWith(expect.anything(), LEARNER);
  });

  it("payment.failed answers 200 with the claim pending; the mail goes out after the response", async () => {
    const res = await deliver("payment.failed", {
      id: "pay_DUN1", status: "open", membership: { id: "mem_DUN1" },
      metadata: { medpruef_user_id: LEARNER }, user: { email: "l@example.com" }, recovery_url: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mail: "queued" });
    expect(h.zoho).not.toHaveBeenCalled();
    expect(claims.get("recover:pay_DUN1")).toMatchObject({ mail: "pending" });
    for (const d of h.deferred) await d.task();
    expect(h.zoho).toHaveBeenCalledTimes(1);
    expect(claims.get("recover:pay_DUN1")).toMatchObject({ mail: "sent" });
  });
});
