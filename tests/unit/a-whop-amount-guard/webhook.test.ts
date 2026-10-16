/**
 * a-whop-grant-amount-guard (Whop review G2): the Pro webhook grants only an
 * EUR charge of at least 80 percent of the tier price. Under enforce an
 * under-price, a non-EUR and a 100 percent promo payment each grant nothing
 * and raise exactly one alert, also across a redelivery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { whopSignedHeaders, useWhopV1Secret } from "../helpers/whop-signed";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/after-response", () => ({ afterResponse: vi.fn(async () => undefined) }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => false }));

const store = vi.hoisted(() => ({ calls: [] as unknown[], claims: new Set<string>(), payloads: new Map<string, unknown>() }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall): FakeResult | undefined => {
      store.calls.push(c);
      if (c.table === "processed_webhook_events" && c.op === "insert") {
        const p = c.payload as { provider: string; event_id: string };
        const key = `${p.provider}:${p.event_id}`;
        if (store.claims.has(key)) return { error: { code: "23505", message: "duplicate key" } };
        store.claims.add(key);
        store.payloads.set(key, (c.payload as { payload?: unknown }).payload ?? {});
        return { data: { event_id: p.event_id } };
      }
      // release-int-8 (a-whop-webhook-ack): the redelivery reads the kept claim's outcome stamp.
      if (c.table === "processed_webhook_events" && c.op === "update") {
        const key = `${eqVal(c, "provider")}:${eqVal(c, "event_id")}`;
        if (store.claims.has(key)) store.payloads.set(key, (c.payload as { payload?: unknown }).payload ?? {});
        return { data: [] };
      }
      if (c.table === "processed_webhook_events" && c.op === "select") {
        const key = `${eqVal(c, "provider") ?? "whop"}:${eqVal(c, "event_id")}`;
        return store.claims.has(key) ? { data: { payload: store.payloads.get(key), processed_at: new Date().toISOString() } } : { data: null };
      }
      if (c.table === "users" && c.op === "select") {
        const id = eqVal(c, "id") as string | undefined;
        return id === USER ? { data: { id, tier: "free", tier_expires_at: null, role: "user", email: "learner@example.test" } } : { data: null };
      }
      if (c.table === "subscriptions" && c.op === "select") return { data: [] };
      if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_new" } };
      if (c.table === "payment_events" && c.op === "select") return { data: [] };
      if (c.table === "user_events" && c.op === "select") return { data: [] };
      return {};
    });
    void calls;
    return sb;
  },
}));

const USER = "573a6d8c-7871-4c77-8b88-d0748b7f4785";

import { POST } from "@/app/api/webhooks/whop/route";
import { logPaymentEvent } from "@/lib/paymentEvents";

const calls = () => store.calls as FakeCall[];
const grants = () => calls().filter((c) => (c.table === "subscriptions" && c.op !== "select") || (c.table === "users" && c.op === "update"));
const alertRows = () => calls().filter((c) => c.table === "user_events" && c.op === "insert" && (c.payload as { event_type: string }).event_type === "whop_payment_amount_mismatch");

function deliver(data: Record<string, unknown>) {
  return POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
    method: "POST",
    headers: whopSignedHeaders(JSON.stringify({ action: "payment.succeeded", data })),
    body: JSON.stringify({ action: "payment.succeeded", data }),
  }));
}
const paid = (id: string, extra: Record<string, unknown>) => ({
  id, plan: { id: "plan_m19" }, membership: { id: `mem_${id}` },
  metadata: { medpruef_user_id: USER, tier: "first_month_19" },
  final_amount: 19, amount_after_fees: 17.72, currency: "eur", ...extra,
});

beforeEach(() => {
  useWhopV1Secret();
  process.env.WHOP_PLAN_FIRST_MONTH_19 = "plan_m19";
  process.env.WHOP_PLAN_NOTES_TRIAL = "plan_trial";
  store.calls = [];
  store.claims = new Set();
  store.payloads = new Map();
  vi.mocked(logPaymentEvent).mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.WHOP_AMOUNT_GUARD;
});

describe("webhook amount guard, enforce", () => {
  beforeEach(() => { process.env.WHOP_AMOUNT_GUARD = "enforce"; });

  for (const [label, data, cause] of [
    ["an under-price payment (9 EUR for the 19 EUR month)", paid("pay_under", { final_amount: 9, amount_after_fees: 8.4 }), "under_price"],
    ["a non-EUR payment (adaptive pricing)", paid("pay_egp", { final_amount: 980, amount_after_fees: 900, currency: "egp" }), "currency"],
    ["a 100 percent promo payment (EUR 0)", paid("pay_promo", { final_amount: 0, amount_after_fees: 0 }), "zero_amount"],
  ] as const) {
    it(`${label}: no grant, one alert, also after a redelivery`, async () => {
      const res = await deliver(data);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ activated: false, reason: "amount_mismatch" });
      expect(grants()).toEqual([]);
      expect(alertRows()).toHaveLength(1);
      expect((alertRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ payment_id: data.id, cause, held: true, source: "webhook" });
      const failed = vi.mocked(logPaymentEvent).mock.calls.map((c) => c[1]).filter((e) => e.event === "grant_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ reason: "amount_mismatch", paymentId: data.id });

      // Whop redelivers: the kept claim dedupes, nothing is granted, no second alert.
      const again = await deliver(data);
      expect(await again.json()).toMatchObject({ duplicate: true });
      expect(grants()).toEqual([]);
      expect(alertRows()).toHaveLength(1);
      // The Pro claim was kept (an admin link releases it), never deleted here.
      expect(calls().some((c) => c.table === "processed_webhook_events" && c.op === "delete")).toBe(false);
    });
  }

  it("a paid tier with no amount field at all is held (no_amount)", async () => {
    const res = await deliver({ id: "pay_noamt", plan: { id: "plan_m19" }, membership: { id: "mem_noamt" }, metadata: { medpruef_user_id: USER, tier: "first_month_19" }, currency: "eur" });
    expect(await res.json()).toMatchObject({ activated: false, reason: "amount_mismatch" });
    expect(grants()).toEqual([]);
    expect((alertRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ cause: "no_amount" });
  });

  it("a EUR 0 trial-plan renewal (100 percent coupon, billing_reason subscription_cycle) is held, not treated as a trial start", async () => {
    const res = await deliver({ id: "pay_trialcoupon", billing_reason: "subscription_cycle", plan: { id: "plan_trial" }, membership: { id: "mem_tc" }, metadata: { medpruef_user_id: USER, tier: "notes_pro_trial" }, final_amount: 0, amount_after_fees: 0, currency: "eur" });
    expect(await res.json()).toMatchObject({ activated: false, reason: "amount_mismatch" });
    expect(grants()).toEqual([]);
    expect(alertRows()).toHaveLength(1);
  });

  it("a full gross charge whose net after fees and VAT is under 80 percent still grants (gross first)", async () => {
    const res = await deliver(paid("pay_vat", { final_amount: 19, amount_after_fees: 14.8 }));
    expect(await res.json()).toMatchObject({ activated: true });
    expect(alertRows()).toEqual([]);
  });

  it("a full EUR payment grants with no alert", async () => {
    const res = await deliver(paid("pay_ok", {}));
    expect(await res.json()).toMatchObject({ activated: true });
    expect(calls().some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(true);
    expect(alertRows()).toEqual([]);
  });

  it("the EUR 0 card trial start still grants its trial window", async () => {
    const res = await deliver({ id: "pay_trial0", plan: { id: "plan_trial" }, membership: { id: "mem_trial0" }, metadata: { medpruef_user_id: USER, tier: "notes_pro_trial" }, final_amount: 0, amount_after_fees: 0, currency: "eur" });
    expect(await res.json()).toMatchObject({ activated: true });
    expect(alertRows()).toEqual([]);
  });

  it("a EUR 19 trial renewal at net after fees grants", async () => {
    const res = await deliver({ id: "pay_renew", plan: { id: "plan_trial" }, membership: { id: "mem_renew" }, metadata: { medpruef_user_id: USER, tier: "notes_pro_trial" }, amount_after_fees: 17.92, currency: "eur" });
    expect(await res.json()).toMatchObject({ activated: true });
    expect(alertRows()).toEqual([]);
  });
});

describe("webhook amount guard, shadow (default) and off", () => {
  it("shadow grants as today and alerts once", async () => {
    const res = await deliver(paid("pay_shadow", { final_amount: 0, amount_after_fees: 0 }));
    expect(await res.json()).toMatchObject({ activated: true });
    expect(calls().some((c) => c.table === "subscriptions" && c.op === "insert")).toBe(true);
    expect(alertRows()).toHaveLength(1);
    expect((alertRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ held: false, mode: "shadow" });
  });

  it("off grants with no check", async () => {
    process.env.WHOP_AMOUNT_GUARD = "off";
    const res = await deliver(paid("pay_off", { final_amount: 0, amount_after_fees: 0 }));
    expect(await res.json()).toMatchObject({ activated: true });
    expect(alertRows()).toEqual([]);
  });
});
