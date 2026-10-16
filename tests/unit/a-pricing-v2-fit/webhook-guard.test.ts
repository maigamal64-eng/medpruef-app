/**
 * a-pricing-v2-fit: after the renewal guard, Whop deactivates the 6-month
 * membership at the period end (the day before the sitting). The revoke must
 * flip the Whop row and still keep Pro to the day after the sitting, because
 * the guard's zero-amount manual row is other active coverage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ handler: (() => ({})) as (call: unknown) => unknown }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => false }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult | undefined).sb,
}));

import { POST } from "@/app/api/webhooks/whop/route";
import { dayAfterEnd } from "@/lib/pricing-v2/sitting-pass";

const SECRET = "ws_test_secret";
const U = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const GUARD_END = dayAfterEnd("2027-05-04").toISOString();

type Row = Record<string, unknown>;
function matches(row: Row, c: FakeCall): boolean {
  return c.filters.every((f) => {
    if (!(f.column in row)) return true;
    if (f.kind === "eq") return row[f.column] === f.value;
    if (f.kind === "in") return (f.value as unknown[]).includes(row[f.column]);
    if (f.kind === "gt") return String(row[f.column]) > String(f.value);
    return true;
  });
}

describe("membership.deactivated after the renewal guard", () => {
  let owner: Row;
  let rows: Row[];
  let claimed: Map<string, unknown>;
  beforeEach(() => {
    process.env.WHOP_WEBHOOK_SECRET = SECRET;
    // The period end passed: Whop renews no more; now is 3 May 2027 noon.
    vi.useFakeTimers({ now: new Date("2027-05-03T12:00:00Z"), toFake: ["Date"] });
    owner = { id: U, role: "user", tier: "pro", tier_expires_at: GUARD_END, updated_at: "2027-04-27T08:30:00Z", email: "h@example.com", first_name: "H", language_code: "de" };
    rows = [
      { id: "sub_half", user_id: U, tier: "half_year", status: "active", payment_provider: "whop", expires_at: "2027-05-04T11:00:00Z", amount_cents: 10000,
        started_at: "2026-11-04T11:00:00Z", updated_at: "2026-11-04T11:00:00Z", provider_payment_id: "pay_HALF", whop_membership_id: "mem_HALF",
        granted_payment_ids: [{ payment_id: "pay_HALF", amount_cents: 10000, added_months: 6, granted_at: "2026-11-04T11:00:00Z" }] },
      { id: "sub_guard", user_id: U, tier: "half_year", status: "active", payment_provider: "manual", payment_method: "renewal_guard", expires_at: GUARD_END, amount_cents: 0,
        started_at: "2027-05-03T11:00:00Z", updated_at: "2027-04-27T08:30:00Z", provider_payment_id: "renewal_guard:mem_HALF:2027-05-03", whop_membership_id: null, granted_payment_ids: [] },
    ];
    claimed = new Map();
    h.handler = ((c: FakeCall): FakeResult | undefined => {
      if (c.table === "processed_webhook_events") {
        const id = String((c.payload as { event_id?: string } | undefined)?.event_id ?? c.filters.find((f) => f.column === "event_id")?.value ?? "");
        if (c.op === "insert") { if (claimed.has(id)) return { error: { code: "23505" } }; claimed.set(id, (c.payload as { payload: unknown }).payload); return { data: { event_id: id } }; }
        if (c.op === "update") { claimed.set(id, (c.payload as { payload: unknown }).payload); return { data: [{ event_id: id }] }; }
        if (c.op === "select") return c.single ? { data: claimed.has(id) ? { event_id: id, payload: claimed.get(id) } : null } : { data: [] };
        return { data: null };
      }
      if (c.table === "users" && c.op === "select") return { data: c.single ? { ...owner } : [{ ...owner }] };
      if (c.table === "users" && c.op === "update") { Object.assign(owner, c.payload); return { data: [{ id: U }] }; }
      if (c.table === "subscriptions" && c.op === "select") {
        const hit = rows.filter((r) => matches(r, c)).map((r) => structuredClone(r));
        return { data: c.single ? hit[0] ?? null : hit };
      }
      if (c.table === "subscriptions" && c.op === "update") {
        const hit = rows.filter((r) => matches(r, c));
        for (const r of hit) Object.assign(r, c.payload);
        return { data: hit.map((r) => ({ id: r.id })) };
      }
      return { data: [] };
    }) as (call: unknown) => unknown;
  });

  it("flips the Whop row and keeps Pro to the day after the sitting", async () => {
    const res = await POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      headers: { "webhook-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({ action: "membership.deactivated", data: { id: "mem_HALF" } }),
    }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(rows.find((r) => r.id === "sub_half")!.status).toBe("cancelled");
    expect(rows.find((r) => r.id === "sub_guard")!.status).toBe("active");
    expect(owner.tier).toBe("pro");
    expect(owner.tier_expires_at).toBe(GUARD_END);
  });

  it("the guard row alone (compare-and-set lost) still carries Pro to the day after the sitting", async () => {
    owner.tier_expires_at = "2027-05-04T11:00:00Z";
    const res = await POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      headers: { "webhook-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({ action: "membership.deactivated", data: { id: "mem_HALF" } }),
    }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(owner.tier).toBe("pro");
    expect(Date.parse(String(owner.tier_expires_at))).toBe(Date.parse(GUARD_END));
  });

  it("control: no guard at all, the same delivery ends Pro", async () => {
    owner.tier_expires_at = "2027-05-04T11:00:00Z";
    rows = rows.filter((r) => r.id !== "sub_guard");
    const res = await POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
      method: "POST",
      headers: { "webhook-secret": SECRET, "content-type": "application/json" },
      body: JSON.stringify({ action: "membership.deactivated", data: { id: "mem_HALF" } }),
    }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect(owner.tier).toBe("free");
  });
});
