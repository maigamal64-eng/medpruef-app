/**
 * a-whop-cancel-signal acceptance: a signed Whop renewal or case event gives
 * one user_events log row and one secretary-bot alert, writes nothing to
 * subscriptions or users, and logs no grant_failed. Retries of the same
 * message (same webhook-id) log and alert once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { useWhopV1Secret, whopSignedHeaders } from "../helpers/whop-signed";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; op: string; payload?: unknown; filters: unknown[] }>,
  deferred: [] as Array<() => Promise<void>>,
  paymentEvents: [] as Array<Record<string, unknown>>,
  failLog: false,
}));
vi.mock("@/lib/after-response", () => ({
  afterResponse: async (_label: string, task: () => Promise<void>) => { h.deferred.push(task); },
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn(async (_sb: unknown, row: Record<string, unknown>) => { h.paymentEvents.push(row); }) }));

const LEARNER = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const claims = new Map<string, Record<string, unknown>>();

function handler(c: FakeCall): FakeResult | undefined {
  h.calls.push({ table: c.table, op: c.op, payload: c.payload, filters: c.filters });
  if (c.table === "processed_webhook_events") {
    if (c.op === "insert") {
      const row = c.payload as { event_id: string; payload: Record<string, unknown> };
      if (claims.has(row.event_id)) return { error: { code: "23505", message: "duplicate key" } };
      claims.set(row.event_id, row.payload);
      return { data: null };
    }
    if (c.op === "update") {
      const id = eqVal(c, "event_id") as string;
      claims.set(id, (c.payload as { payload: Record<string, unknown> }).payload);
      return { data: null };
    }
    if (c.op === "delete") { claims.delete(eqVal(c, "event_id") as string); return {}; }
  }
  if (c.table === "user_events" && c.op === "insert" && h.failLog) return { error: { code: "XX000", message: "boom" } };
  if (c.table === "subscriptions" && c.op === "select") {
    if (eqVal(c, "whop_membership_id") === "mem_pinned") return { data: [{ user_id: LEARNER, tier: "first_month_19" }] };
    if (eqVal(c, "provider_payment_id") === "pay_case1") return { data: [{ user_id: LEARNER }] };
    return { data: [] };
  }
  if (c.table === "users" && c.op === "select") return { data: null };
  return {};
}

vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((c) => handler(c)).sb,
}));

import { POST } from "@/app/api/webhooks/whop/route";

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

function deliver(body: Record<string, unknown>, id?: string) {
  const raw = JSON.stringify(body);
  return POST(new NextRequest("https://medpruf.com/api/webhooks/whop", { method: "POST", headers: whopSignedHeaders(raw, { id }), body: raw }));
}
async function runDeferred() { for (const t of h.deferred.splice(0)) await t(); }

const cancelEvent = (flag: boolean) => ({
  type: "membership.cancel_at_period_end_changed",
  api_version: "v1",
  data: {
    id: "mem_pinned", status: "active", cancel_at_period_end: flag, current_period_end: "2026-11-04T10:00:00Z",
    plan_id: "plan_month", product: { id: "prod_x", title: "MedPrüf Access" }, cancel_option: "too_expensive",
    cancellation_reason: "Max Mustermann, max@example.com", manage_url: "https://whop.com/billing/manage/abc",
  },
});

const writes = () => h.calls.filter((c) => c.op !== "select");

beforeEach(() => {
  useWhopV1Secret();
  process.env.WHOP_PLAN_FIRST_MONTH_19 = "plan_month";
  process.env.WHOP_SIGNAL_ALERTS_ENABLED = "true";
  process.env.TELEGRAM_SECRETARY_TOKEN = "123:secret";
  claims.clear();
  h.calls = []; h.deferred = []; h.paymentEvents = []; h.failLog = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["WHOP_PLAN_FIRST_MONTH_19", "WHOP_SIGNAL_ALERTS_ENABLED", "TELEGRAM_SECRETARY_TOKEN"]) delete process.env[k];
});

describe("membership.cancel_at_period_end_changed", () => {
  it("logs one row, sends one alert, writes no subscription or user row, no grant_failed", async () => {
    const res = await deliver(cancelEvent(true), "msg_cancel_1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, signal: "renewal", matched: true });
    await runDeferred();

    const logs = writes().filter((c) => c.table === "user_events");
    expect(logs).toHaveLength(1);
    expect(logs[0].payload).toMatchObject({
      user_id: LEARNER, event_type: "whop_renewal_signal",
      event_data: expect.objectContaining({ membership_id: "mem_pinned", cancel_at_period_end: true, match: "pin", product: "Pro" }),
    });
    expect(JSON.stringify(logs[0].payload)).not.toContain("example.com");
    expect(writes().filter((c) => c.table === "subscriptions" || c.table === "users")).toHaveLength(0);
    expect(h.paymentEvents.filter((e) => e.event === "grant_failed")).toHaveLength(0);
    expect(h.paymentEvents.find((e) => e.event === "webhook_received")?.paymentId ?? null).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/bot123:secret/sendMessage");
    const sent = JSON.parse(String(init.body));
    expect(sent.chat_id).toBe("0");
    expect(sent.text).toContain("renewal turned OFF");
    expect(sent.text).toContain(`/admin/users/${LEARNER}`);
    expect(sent.text).not.toContain("Mustermann");
    expect(sent.text).not.toContain("—");
    expect(claims.get("whop_signal:msg_cancel_1")).toMatchObject({ alert: "sent" });
  });

  it("a Whop retry of the same message logs and alerts once", async () => {
    await deliver(cancelEvent(true), "msg_retry");
    await runDeferred();
    const again = await deliver(cancelEvent(true), "msg_retry");
    expect(await again.json()).toMatchObject({ duplicate: true });
    await runDeferred();
    expect(writes().filter((c) => c.table === "user_events")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("logs without alerting while the alert flag is off", async () => {
    delete process.env.WHOP_SIGNAL_ALERTS_ENABLED;
    const res = await deliver(cancelEvent(false), "msg_off");
    expect(res.status).toBe(200);
    await runDeferred();
    expect(writes().filter((c) => c.table === "user_events")).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed log write answers 503 and frees the claim for Whop's retry", async () => {
    h.failLog = true;
    const res = await deliver(cancelEvent(true), "msg_fail");
    expect(res.status).toBe(503);
    expect(claims.has("whop_signal:msg_fail")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unpinned membership is still logged, under the sentinel user", async () => {
    const body = cancelEvent(true);
    (body.data as Record<string, unknown>).id = "mem_unknown";
    await deliver(body, "msg_unpinned");
    await runDeferred();
    const log = writes().find((c) => c.table === "user_events");
    expect(log?.payload).toMatchObject({ user_id: "whop-webhook", event_data: expect.objectContaining({ match: "none" }) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("membership.updated (v1 hook)", () => {
  it("is a renewal signal when previous_attributes names cancel_at_period_end", async () => {
    const body = { ...cancelEvent(true), type: "membership.updated", previous_attributes: { cancel_at_period_end: false } };
    const res = await deliver(body, "msg_upd");
    expect(await res.json()).toMatchObject({ signal: "renewal" });
    await runDeferred();
    expect(writes().filter((c) => c.table === "user_events")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("any other membership update is acked quietly: no log, no alert, no grant_failed", async () => {
    const body = { ...cancelEvent(true), type: "membership.updated", previous_attributes: { metadata: {} } };
    const res = await deliver(body, "msg_upd2");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: "membership.updated" });
    expect(writes().filter((c) => c.table === "user_events" || c.table === "subscriptions")).toHaveLength(0);
    expect(h.paymentEvents.filter((e) => e.event === "grant_failed")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolution_center_case.created", () => {
  it("logs one row and alerts once, never revokes, no grant_failed", async () => {
    const res = await deliver({
      type: "resolution_center_case.created",
      data: {
        id: "reso_1", status: "awaiting_merchant", reason: "product_not_received", amount: 19, currency: "eur",
        response_due_at: "2026-10-23T00:00:00Z", payment: { id: "pay_case1" }, plan_id: "plan_month",
        buyer: { email: "buyer@example.com", name: "Buyer Name" },
      },
    }, "msg_case");
    expect(res.status).toBe(200);
    await runDeferred();
    const logs = writes().filter((c) => c.table === "user_events");
    expect(logs).toHaveLength(1);
    expect(logs[0].payload).toMatchObject({ user_id: LEARNER, event_type: "whop_case_signal" });
    expect(JSON.stringify(logs[0].payload)).not.toContain("example.com");
    expect(writes().filter((c) => c.table === "subscriptions" || c.table === "users")).toHaveLength(0);
    expect(h.paymentEvents.filter((e) => e.event === "grant_failed")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const text = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).text as string;
    expect(text).toContain("reso_1");
    expect(text).toContain("2026-10-23");
    expect(text).not.toContain("Buyer Name");
  });
});

describe("non-payment events never use data.id as a payment id", () => {
  it("an unknown membership event with a mem_ id is acked quietly", async () => {
    const res = await deliver({ type: "membership.metadata_updated", data: { id: "mem_pinned" } }, "msg_meta");
    expect(res.status).toBe(200);
    expect(h.paymentEvents.filter((e) => e.event === "grant_failed")).toHaveLength(0);
    expect(h.paymentEvents.find((e) => e.event === "webhook_received")?.paymentId ?? null).toBeNull();
  });

  it("an unknown payment.* event with a pay_ id still raises grant_failed", async () => {
    await deliver({ type: "payment.authorized", data: { id: "pay_abc" } }, "msg_auth");
    expect(h.paymentEvents.filter((e) => e.event === "grant_failed")).toHaveLength(1);
  });
});
