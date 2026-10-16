/**
 * a-whop-grant-amount-guard (Whop review G2) on POST /api/whop/checkout/verify:
 * the main path, the email match and the step 3b fallback grant only an EUR
 * charge of at least 80 percent of the tier price. Under enforce a mismatch is
 * never claimed or granted, alerts once across the page's polling, and a
 * payment the webhook held (claim kept) is never released and granted here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const USER = "22222222-2222-4222-8222-222222222222";
const h = vi.hoisted(() => ({
  owner: {} as Record<string, unknown>,
  fallbackRows: [] as unknown[],
  heldRows: [] as unknown[],
  heldAlerts: [] as unknown[],
  calls: [] as unknown[],
  claims: new Set<string>(),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn(), hashEmail: vi.fn(() => "hash_synthetic") }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/after-response", () => ({ afterResponse: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: USER }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }), rateKey: () => "k", rateLimitHeaders: () => ({}) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase((c: FakeCall) => {
  h.calls.push(c);
  if (c.table === "user_events" && c.op === "select") return { data: h.heldAlerts };
  if (c.table === "users" && c.op === "select") return { data: c.single ? h.owner : [{ id: USER }] };
  if (c.table === "users" && c.op === "update") { h.owner = { ...h.owner, ...(c.payload as object) }; return { data: { id: USER } }; }
  if (c.table === "subscriptions" && c.op === "select") return { data: [] };
  if (c.table === "subscriptions" && c.op === "insert") return { data: { id: "sub_synthetic" } };
  if (c.table === "processed_webhook_events" && c.op === "insert") {
    const p = c.payload as { provider: string; event_id: string };
    const key = `${p.provider}:${p.event_id}`;
    if (h.claims.has(key)) return { error: { code: "23505", message: "duplicate" } };
    h.claims.add(key);
    return { data: { event_id: p.event_id } };
  }
  if (c.table === "processed_webhook_events" && c.op === "delete") {
    const provider = c.filters.find((f) => f.column === "provider")?.value;
    const id = c.filters.find((f) => f.column === "event_id")?.value;
    h.claims.delete(`${provider}:${id}`);
    return {};
  }
  if (c.table === "payment_events" && c.op === "select") {
    const ev = c.filters.find((f) => f.kind === "eq" && f.column === "event");
    if (ev?.value === "webhook_received") return { data: h.fallbackRows };
    if (ev?.value === "grant_failed" && c.filters.some((f) => f.column === "reason" && f.value === "amount_mismatch")) return { data: h.heldRows };
    return { data: [] };
  }
  return {};
}).sb }));

import { POST } from "@/app/api/whop/checkout/verify/route";
import { logPaymentEvent } from "@/lib/paymentEvents";

const PLAN = "plan_redacted4b0850d6";
const recent = () => new Date(Date.now() - 3600_000).toISOString();
const req = () => new NextRequest("https://x/api/whop/checkout/verify", { method: "POST", body: JSON.stringify({ tier: "first_month_19" }) });
const calls = () => h.calls as FakeCall[];
const proClaims = () => calls().filter((c) => c.table === "processed_webhook_events" && c.op === "insert" && (c.payload as { provider: string }).provider === "whop");
const grants = () => calls().filter((c) => c.table === "subscriptions" && c.op !== "select");
const alertRows = () => calls().filter((c) => c.table === "user_events" && c.op === "insert" && (c.payload as { event_type: string }).event_type === "whop_payment_amount_mismatch");

function stubLedger(payment: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    if (input.includes("/memberships")) {
      return new Response(JSON.stringify({ data: [{ id: "mem_syn", status: "active", plan: { id: PLAN }, metadata: { medpruef_user_id: USER }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [{ id: "pay_syn", status: "paid", membership: { id: "mem_syn" }, created_at: recent(), final_amount: 19, currency: "eur", ...payment }], page_info: { end_cursor: "c", has_next_page: false } }), { status: 200 });
  }));
}

beforeEach(() => {
  h.owner = { tier: "free", role: "user", tier_expires_at: null, email: "synthetic@example.test" };
  h.fallbackRows = [];
  h.heldRows = [];
  h.heldAlerts = [];
  h.calls = [];
  h.claims = new Set();
  vi.mocked(logPaymentEvent).mockClear();
  vi.stubEnv("WHOP_API_KEY", "k_synthetic");
  vi.stubEnv("WHOP_PLAN_FIRST_MONTH_19", PLAN);
  vi.stubEnv("WHOP_COMPANY_ID", "biz_synthetic");
  vi.stubEnv("WHOP_AMOUNT_GUARD", "enforce");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("checkout verify amount guard, enforce", () => {
  for (const [label, payment, cause] of [
    ["an under-price payment", { final_amount: 9 }, "under_price"],
    ["a non-EUR payment", { final_amount: 980, currency: "egp" }, "currency"],
    ["a 100 percent promo payment", { final_amount: 0 }, "zero_amount"],
  ] as const) {
    it(`${label}: no claim, no grant, one alert across polling`, async () => {
      stubLedger(payment);
      for (let poll = 0; poll < 3; poll++) {
        expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_syn", held: "amount_mismatch" });
      }
      expect(proClaims()).toEqual([]);
      expect(grants()).toEqual([]);
      expect(alertRows()).toHaveLength(1);
      expect((alertRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ cause, source: "checkout_verify", held: true });
      const failed = vi.mocked(logPaymentEvent).mock.calls.map((c) => c[1]).filter((e) => e.event === "grant_failed");
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ reason: "amount_mismatch" });
    });
  }

  it("a full EUR payment still grants", async () => {
    stubLedger({});
    expect(await (await POST(req())).json()).toMatchObject({ granted: true, payment_ref: "pay_syn" });
    expect(alertRows()).toEqual([]);
  });

  it("a payment the webhook already alerted on raises no second alert here", async () => {
    stubLedger({ final_amount: 0 });
    h.claims.add("whop_amount_hold:pay_syn");
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, held: "amount_mismatch" });
    expect(alertRows()).toEqual([]);
    expect(vi.mocked(logPaymentEvent).mock.calls.some((c) => c[1].event === "grant_failed")).toBe(false);
  });
});

describe("checkout verify step 3b with the amount guard", () => {
  function stub3b(payment: Record<string, unknown>) {
    h.fallbackRows = [{ id: 901, event: "webhook_received", payment_id: "pay_3b", tier: null, amount_cents: 0, metadata: { whop_event: "payment.succeeded" }, created_at: recent() }];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (/\/payments\/pay_3b/.test(input)) {
        return new Response(JSON.stringify({ id: "pay_3b", status: "paid", plan: { id: PLAN }, membership: { id: "mem_3b" }, final_amount: 19, currency: "eur", created_at: recent(), ...payment }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [], page_info: { end_cursor: null, has_next_page: false }, total_count: 0 }), { status: 200 });
    }));
  }

  it("a non-EUR payment the webhook held (Pro claim kept) is never released and granted", async () => {
    stub3b({ final_amount: 980, currency: "egp" });
    h.claims.add("whop:pay_3b"); // the webhook kept its claim, no grant_succeeded row
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_3b" });
    expect(calls().some((c) => c.table === "processed_webhook_events" && c.op === "delete" && c.filters.some((f) => f.value === "whop"))).toBe(false);
    expect(h.claims.has("whop:pay_3b")).toBe(true);
    expect(grants()).toEqual([]);
    expect(alertRows()).toHaveLength(1);
    expect((alertRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ cause: "currency", source: "checkout_verify_fallback" });
  });

  it("reviewer P1: a payment the webhook held is not released and granted when 3b's re-read looks clean", async () => {
    stub3b({}); // Whop's record shows a full EUR 19
    h.claims.add("whop:pay_3b"); // the webhook kept its claim when it held the payment
    h.heldRows = [{ id: 77 }]; // ...and wrote grant_failed reason amount_mismatch
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_3b" });
    expect(calls().some((c) => c.table === "processed_webhook_events" && c.op === "delete")).toBe(false);
    expect(h.claims.has("whop:pay_3b")).toBe(true);
    expect(grants()).toEqual([]);
  });

  it("reviewer P2: the held alert row alone also keeps the webhook's claim (funnel row lost)", async () => {
    stub3b({});
    h.claims.add("whop:pay_3b");
    h.heldAlerts = [{ id: 5 }];
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_3b" });
    expect(h.claims.has("whop:pay_3b")).toBe(true);
    expect(grants()).toEqual([]);
    const q = calls().find((c) => c.table === "user_events" && c.op === "select");
    expect(q?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "contains", column: "event_data", value: { payment_id: "pay_3b", held: true } })]));
  });

  it("an under-price payment found by 3b grants nothing", async () => {
    stub3b({ final_amount: 5 });
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_unmatched" });
    expect(grants()).toEqual([]);
    expect(alertRows()).toHaveLength(1);
  });

  it("a confirmed full EUR payment found by 3b still grants", async () => {
    stub3b({});
    expect(await (await POST(req())).json()).toMatchObject({ granted: true, payment_ref: "pay_3b" });
    expect(alertRows()).toEqual([]);
  });
});

describe("checkout verify amount guard: email match and shadow", () => {
  it("the email-match path holds an under-price payment under enforce", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input.includes("/memberships")) {
        return new Response(JSON.stringify({ data: [{ id: "mem_em", status: "active", plan: { id: PLAN }, member: { email: "synthetic@example.test" }, created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ id: "pay_em", status: "paid", membership: { id: "mem_em" }, final_amount: 4, currency: "eur", created_at: recent() }], page_info: { end_cursor: "c", has_next_page: false } }), { status: 200 });
    }));
    expect(await (await POST(req())).json()).toMatchObject({ granted: false, reason: "payment_unmatched", payment_ref: "pay_em" });
    expect(grants()).toEqual([]);
    expect(proClaims()).toEqual([]);
    expect(alertRows()).toHaveLength(1);
    expect((alertRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ source: "checkout_verify_email", cause: "under_price" });
  });

  it("shadow grants a mismatched payment as before and alerts once", async () => {
    vi.stubEnv("WHOP_AMOUNT_GUARD", "shadow");
    stubLedger({ final_amount: 980, currency: "egp" });
    expect(await (await POST(req())).json()).toMatchObject({ granted: true, payment_ref: "pay_syn" });
    expect(alertRows()).toHaveLength(1);
    expect((alertRows()[0].payload as { event_data: Record<string, unknown> }).event_data).toMatchObject({ held: false, cause: "currency" });
  });
});
