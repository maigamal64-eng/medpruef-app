/**
 * a-whop-cancel-signal: the daily membership read (fallback) and the pure rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import {
  classifyWhopSignal,
  dailyReadDecision,
  formatSignalAlert,
  gatedPaymentId,
  readSignalAlertConfig,
  renewalStateKey,
  signalClaimKey,
  type RenewalSignal,
} from "@/lib/whop-signal";

const h = vi.hoisted(() => ({ calls: [] as Array<{ table: string; op: string; payload?: unknown; filters: Array<{ kind: string; column: string; value: unknown }> }> }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));

const keys = new Set<string>();
function handler(c: FakeCall): FakeResult | undefined {
  h.calls.push({ table: c.table, op: c.op, payload: c.payload, filters: c.filters });
  if (c.table === "subscriptions" && c.op === "select" && c.filters.some((f) => f.column === "status")) {
    return { data: [
      { whop_membership_id: "mem_a", tier: "first_month_19", payment_provider: "whop" },
      { whop_membership_id: "mem_b", tier: "first_month_19", payment_provider: "whop" },
    ] };
  }
  if (c.table === "subscriptions" && c.op === "select") return { data: [{ user_id: "u1", tier: "first_month_19" }] };
  if (c.table === "processed_webhook_events" && c.op === "select") {
    const wanted = (c.filters.find((f) => f.kind === "in")?.value ?? []) as string[];
    return { data: wanted.filter((k) => keys.has(k)).map((event_id) => ({ event_id })) };
  }
  if (c.table === "processed_webhook_events" && c.op === "insert") {
    const id = (c.payload as { event_id: string }).event_id;
    if (keys.has(id)) return { error: { code: "23505" } };
    keys.add(id);
    return {};
  }
  return {};
}
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase((c) => handler(c)).sb }));

import { GET } from "@/app/api/cron/whop-cancel-read/route";

const membership = (id: string, flag: boolean) => ({
  id, status: "active", cancel_at_period_end: flag, renewal_period_end: 1793865600, plan: { id: "plan_month" },
});
let whopState: Record<string, boolean> = {};
let whopStatus = 200;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith("https://api.telegram.org/")) return new Response("{}", { status: 200 });
  expect(init?.method).toBe("GET");
  expect((init?.headers as Record<string, string>)["Api-Version-Date"]).toBeTruthy();
  const id = decodeURIComponent(url.split("/").pop() as string);
  if (whopStatus !== 200) return new Response("{}", { status: whopStatus });
  return new Response(JSON.stringify(membership(id, whopState[id] ?? false)), { status: 200 });
});
const call = () => GET(new NextRequest("https://medpruf.com/api/cron/whop-cancel-read", { headers: { authorization: "Bearer cron" } }));

beforeEach(() => {
  process.env.CRON_SECRET = "cron";
  process.env.WHOP_CANCEL_READ_ENABLED = "true";
  process.env.WHOP_API_KEY = "key";
  process.env.WHOP_PLAN_FIRST_MONTH_19 = "plan_month";
  process.env.WHOP_SIGNAL_ALERTS_ENABLED = "true";
  process.env.TELEGRAM_SECRETARY_TOKEN = "1:t";
  keys.clear(); h.calls = []; whopState = {}; whopStatus = 200;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["CRON_SECRET", "WHOP_CANCEL_READ_ENABLED", "WHOP_API_KEY", "WHOP_PLAN_FIRST_MONTH_19", "WHOP_SIGNAL_ALERTS_ENABLED", "TELEGRAM_SECRETARY_TOKEN"]) delete process.env[k];
});

const telegramCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("https://api.telegram.org/"));
const writes = () => h.calls.filter((c) => c.op !== "select");

describe("GET /api/cron/whop-cancel-read", () => {
  it("off: answers enabled:false with no read", async () => {
    delete process.env.WHOP_CANCEL_READ_ENABLED;
    expect(await (await call()).json()).toEqual({ enabled: false });
    expect(h.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses without the cron secret", async () => {
    const res = await GET(new NextRequest("https://medpruf.com/api/cron/whop-cancel-read"));
    expect(res.status).toBe(401);
  });

  it("reports a renewal turned off once per period, never writes subscriptions", async () => {
    whopState = { mem_a: true };
    const first = await (await call()).json();
    expect(first).toMatchObject({ ok: true, read: 2, reported: 1, alerts_sent: 1 });
    expect(writes().filter((c) => c.table === "user_events")).toHaveLength(1);
    expect(writes().filter((c) => c.table === "subscriptions" || c.table === "users")).toHaveLength(0);
    const second = await (await call()).json();
    expect(second).toMatchObject({ reported: 0 });
    expect(telegramCalls()).toHaveLength(1);
  });

  it("reports back on only after an off was recorded", async () => {
    expect(await (await call()).json()).toMatchObject({ reported: 0 });
    whopState = { mem_a: true };
    await call();
    whopState = { mem_a: false };
    expect(await (await call()).json()).toMatchObject({ reported: 1 });
    expect(telegramCalls()).toHaveLength(2);
  });

  it("stops on a refused key and says so", async () => {
    whopStatus = 403;
    expect(await (await call()).json()).toMatchObject({ ok: false, reason: "key_unauthorized", status: 403 });
    expect(writes()).toHaveLength(0);
  });
});

describe("pure rules", () => {
  const base: RenewalSignal = {
    kind: "renewal", event: "x", membershipId: "mem_a", cancelAtPeriodEnd: true, periodEnd: "2026-11-04T00:00:00.000Z",
    status: "active", planId: null, productId: null, cancelOption: null, manageUrl: null, metaUserId: null,
  };

  it("classifies only the signal events", () => {
    expect(classifyWhopSignal("membership.cancel_at_period_end_changed", { data: { id: "mem_a", cancel_at_period_end: true } })?.kind).toBe("renewal");
    expect(classifyWhopSignal("resolution.decided", { data: { id: "reso_1" } })?.kind).toBe("case");
    expect(classifyWhopSignal("resolution_center_case.updated", { data: { id: "reso_1" } })?.kind).toBe("case");
    expect(classifyWhopSignal("membership.updated", { data: { id: "mem_a" } })).toBeNull();
    expect(classifyWhopSignal("membership.updated", { data: { id: "mem_a", cancel_at_period_end: true }, previous_attributes: { cancel_at_period_end: true } })).toBeNull();
    expect(classifyWhopSignal("membership.deactivated", { data: { id: "mem_a" } })).toBeNull();
    expect(classifyWhopSignal("payment.succeeded", { data: { id: "pay_1" } })).toBeNull();
  });

  it("drops a manage link that is not whop.com", () => {
    const s = classifyWhopSignal("membership.cancel_at_period_end_changed", { data: { id: "mem_a", manage_url: "https://evil.example/billing/manage/x" } });
    expect(s?.kind === "renewal" && s.manageUrl).toBeNull();
  });

  it("gates data.id as a payment id to payment events", () => {
    expect(gatedPaymentId("payment.succeeded", { id: "pay_1" }, "pay_1")).toBe("pay_1");
    expect(gatedPaymentId("membership.updated", { id: "mem_1" }, "mem_1")).toBeNull();
    expect(gatedPaymentId("resolution_center_case.created", { id: "reso_1", payment: { id: "pay_2" } }, "reso_1")).toBe("pay_2");
    expect(gatedPaymentId("something.new", { id: "pay_3" }, "pay_3")).toBe("pay_3");
  });

  it("claim keys use the webhook id, else a body hash", () => {
    expect(signalClaimKey("msg_abc", "{}")).toBe("whop_signal:msg_abc");
    expect(signalClaimKey(null, "{}")).toMatch(/^whop_signal:sha256:[0-9a-f]{40}$/);
    expect(signalClaimKey("bad id\n", "{}")).toMatch(/^whop_signal:sha256:/);
  });

  it("daily decision: off once, on only after off", () => {
    const none = () => false;
    expect(dailyReadDecision(base, none)).toEqual({ report: true, key: renewalStateKey("mem_a", true, base.periodEnd) });
    expect(dailyReadDecision({ ...base, cancelAtPeriodEnd: false }, none).report).toBe(false);
    const offSeen = (k: string) => k === renewalStateKey("mem_a", true, base.periodEnd);
    expect(dailyReadDecision(base, offSeen).report).toBe(false);
    expect(dailyReadDecision({ ...base, cancelAtPeriodEnd: false }, offSeen).report).toBe(true);
    expect(dailyReadDecision({ ...base, status: "canceled" }, none).report).toBe(false);
  });

  it("alert text: ids and dates, no em dash, [name]-only config", () => {
    const text = formatSignalAlert({ ...base, cancelOption: "too—expensive\nline" }, { userId: null, product: "Pro", origin: "https://medpruf.com/", source: "daily_read" });
    expect(text).not.toContain("—");
    expect(text).toContain("Access ends: 2026-11-04");
    expect(text).toContain("not matched");
    expect(readSignalAlertConfig({ WHOP_SIGNAL_ALERTS_ENABLED: "true" }).enabled).toBe(false);
    expect(readSignalAlertConfig({ TELEGRAM_SECRETARY_TOKEN: "x" }).enabled).toBe(false);
    expect(readSignalAlertConfig({ WHOP_SIGNAL_ALERTS_ENABLED: "true", TELEGRAM_SECRETARY_TOKEN: "x" }).enabled).toBe(true);
  });
});
