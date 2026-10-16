/**
 * a-renew-early, the webhook: a membership-only revoke flips only the row
 * pinned to that membership (an early renewal or a switch keeps its own row
 * and Pro), and the switch stop runs only after the new payment is granted;
 * a transient stop failure answers 503 so Whop's redelivery retries it.
 * Harness as tests/unit/a-pricing-v2-fit/webhook-guard.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const h = vi.hoisted(() => ({ handler: (() => ({})) as (call: unknown) => unknown, stop: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/webhook-logger", () => ({ logWebhookAttempt: vi.fn() }));
vi.mock("@/lib/paymentEvents", () => ({ logPaymentEvent: vi.fn() }));
vi.mock("@/lib/reddit-capi", () => ({ sendRedditConversion: vi.fn() }));
vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/referral-exam-reward", () => ({ qualifyReferralOnActivity: vi.fn(), isReferralExamRewardEnabled: () => false }));
vi.mock("@/lib/whop-switch", () => ({ stopSwitchedRenewal: h.stop }));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => createFakeSupabase((c) => h.handler(c) as FakeResult | undefined).sb,
}));

import { POST } from "@/app/api/webhooks/whop/route";
import { useWhopV1Secret, whopSigned } from "../helpers/whop-signed";

const U = "573a6d8c-7871-4c77-8b88-d0748b7f4785";
const DAY = 86_400_000;

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
const deliver = (action: string, data: unknown) => POST(new NextRequest("https://medpruf.com/api/webhooks/whop", {
  method: "POST",
  ...whopSigned(JSON.stringify({ action, data })),
}));

let owner: Row;
let rows: Row[];
let claimed: Map<string, unknown>;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const OLD_END = iso(now - 60_000); // Whop deactivates the old membership at its period end
const NEW_END = iso(now + 180 * DAY);

beforeEach(() => {
  useWhopV1Secret();
  delete process.env.WHOP_ATOMIC_GRANTS_ENABLED;
  h.stop.mockReset();
  h.stop.mockResolvedValue("not_switch");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
  owner = { id: U, role: "user", tier: "pro", tier_expires_at: NEW_END, updated_at: iso(now - 5 * DAY), email: "h@example.com", first_name: "H", language_code: "de" };
  rows = [
    { id: "sub_old", user_id: U, tier: "first_month_19", status: "active", payment_provider: "whop", expires_at: iso(now + 2 * 3600_000), amount_cents: 1900,
      started_at: iso(now - 28 * DAY), updated_at: iso(now - 28 * DAY), provider_payment_id: "pay_OLD", whop_membership_id: "mem_OLD1",
      granted_payment_ids: [{ payment_id: "pay_OLD", amount_cents: 1900, added_months: 1, granted_at: iso(now - 28 * DAY) }] },
    { id: "sub_new", user_id: U, tier: "premium_pass_guaranteed", status: "active", payment_provider: "whop", expires_at: NEW_END, amount_cents: 12900,
      started_at: iso(now + 2 * 3600_000), updated_at: iso(now - 5 * DAY), provider_payment_id: "pay_NEW", whop_membership_id: "mem_NEW1",
      granted_payment_ids: [{ payment_id: "pay_NEW", amount_cents: 12900, added_months: 6, granted_at: iso(now - 5 * DAY) }] },
  ];
  void OLD_END;
  claimed = new Map();
  h.handler = ((c: FakeCall): FakeResult | undefined => {
    if (c.table === "processed_webhook_events") {
      const id = String((c.payload as { event_id?: string } | undefined)?.event_id ?? c.filters.find((f) => f.column === "event_id")?.value ?? "");
      if (c.op === "insert") { if (claimed.has(id)) return { error: { code: "23505", message: "duplicate key" } }; claimed.set(id, (c.payload as { payload: unknown }).payload); return { data: { event_id: id } }; }
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
    if (c.table === "subscriptions" && c.op === "insert") { rows.push({ id: "sub_ins", ...(c.payload as Row) }); return { data: { id: "sub_ins" } }; }
    return { data: [] };
  }) as (call: unknown) => unknown;
});

describe("membership-only revoke with an early renewal", () => {
  it("deactivating the old membership flips only its pinned row; the new row and Pro stay", async () => {
    const res = await deliver("membership.deactivated", { id: "mem_OLD1" });
    expect(res.status).toBe(200);
    expect(rows.find((r) => r.id === "sub_old")!.status).toBe("cancelled");
    expect(rows.find((r) => r.id === "sub_new")!.status).toBe("active");
    expect(owner.tier).toBe("pro");
    expect(Date.parse(String(owner.tier_expires_at))).toBe(Date.parse(NEW_END));
  });
  it("deactivating the stacked membership keeps its paid window (reviewer P1) and never touches the old row", async () => {
    await deliver("membership.deactivated", { id: "mem_NEW1" });
    // Whop billed it from the purchase; the row runs from the old end.
    expect(rows.find((r) => r.id === "sub_new")!.status).toBe("active");
    expect(rows.find((r) => r.id === "sub_new")!.expires_at).toBe(NEW_END);
    expect(rows.find((r) => r.id === "sub_old")!.status).toBe("active");
    expect(owner.tier).toBe("pro");
  });
  it("a refund of the stacked payment still removes it (refunds name payments)", async () => {
    await deliver("refund.created", { id: "rf_1", payment: { id: "pay_NEW" }, membership: { id: "mem_NEW1" } });
    expect(rows.find((r) => r.id === "sub_new")!.status).toBe("refunded");
    expect(rows.find((r) => r.id === "sub_old")!.status).toBe("active");
  });
  it("a membership with no pinned row never falls through to rows pinned to other memberships", async () => {
    rows.push({ id: "sub_legacy", user_id: U, tier: "first_3mo_27", status: "active", payment_provider: "whop", expires_at: iso(now + 9 * DAY), amount_cents: 4900,
      started_at: iso(now - 80 * DAY), updated_at: iso(now - 80 * DAY), provider_payment_id: "pay_LEG", whop_membership_id: null,
      granted_payment_ids: [{ payment_id: "pay_LEG", amount_cents: 4900, added_months: 3, granted_at: iso(now - 80 * DAY) }] });
    await deliver("membership.deactivated", { id: "mem_redacted0ff4b108", metadata: { medpruef_user_id: U } });
    // The by-user fallback ran (the unpinned legacy row is its target, as before).
    expect(rows.find((r) => r.id === "sub_legacy")!.status).toBe("cancelled");
    expect(rows.find((r) => r.id === "sub_old")!.status).toBe("active");
    expect(rows.find((r) => r.id === "sub_new")!.status).toBe("active");
  });
});

describe("switch stop after the grant", () => {
  const pay = (id: string, membership: string, metadata: Record<string, string> | null) => ({
    id, plan: { id: "plan_redacted324decbc" }, user: { email: "h@example.com" }, membership: { id: membership },
    metadata, amount_after_fees: 129, currency: "eur", checkout_configuration_id: "ch_sw1",
  });
  it("runs only after the grant, with the echoed old membership; a transient failure answers 503", async () => {
    rows = rows.filter((r) => r.id === "sub_old");
    const order: string[] = [];
    const prev = h.handler;
    h.handler = ((c: FakeCall) => { if (c.table === "subscriptions" && c.op === "insert") order.push("grant"); return (prev as (x: unknown) => unknown)(c); }) as (call: unknown) => unknown;
    h.stop.mockImplementation(async () => { order.push("stop"); return "retry"; });
    const res = await deliver("payment.succeeded", pay("pay_SW1", "mem_NEW2", { medpruef_user_id: U, tier: "premium_pass_guaranteed", switch_from_membership: "mem_OLD1" }));
    expect(res.status).toBe(503);
    expect(order).toEqual(["grant", "stop"]);
    expect(h.stop.mock.calls[0][1]).toMatchObject({ paymentId: "pay_SW1", newMembershipId: "mem_NEW2", metaSwitchFrom: "mem_OLD1", checkoutConfigId: "ch_sw1" });
    const stacked = rows.find((r) => r.id === "sub_ins")!;
    expect(stacked).toMatchObject({ whop_membership_id: "mem_NEW2", started_at: rows.find((r) => r.id === "sub_old")!.expires_at });
    // Whop redelivers: the duplicate path retries the stop, never a second grant.
    h.stop.mockResolvedValue("stopped");
    const again = await deliver("payment.succeeded", pay("pay_SW1", "mem_NEW2", { medpruef_user_id: U, tier: "premium_pass_guaranteed", switch_from_membership: "mem_OLD1" }));
    expect(again.status).toBe(200);
    expect(h.stop).toHaveBeenCalledTimes(2);
    expect(rows.filter((r) => r.id === "sub_ins")).toHaveLength(1);
  });
});
