import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal } from "../helpers/fake-supabase";
const h = vi.hoisted(() => ({ status: "active", access: true, provider: {} as Record<string, unknown>, activeRow: true, revocation: null as string | null }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/billing-cadence", () => ({ loadRenewalOfferSuppression: async () => ({ suppressed: true }) }));
vi.mock("@/lib/whop-subscription-snapshot", () => ({ loadWhopBillingSnapshot: async () => h.provider, unknownBillingSnapshot: () => ({ billing_cadence: "unknown", next_charge_at: null, next_charge_amount_cents: null }) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase(c => {
  if (c.table === "subscriptions") {
    if (!h.activeRow && eqVal(c, "status") === "active") return { data: null };
    return { data: { id: "sub_a", tier: "first_month_19", status: h.status, started_at: "2026-10-01T00:00:00Z", expires_at: "2026-11-12T00:00:00Z", payment_provider: "whop", amount_cents: 1900, currency: "EUR", provider_payment_id: "pay_a", whop_membership_id: "mem_a" } };
  }
  if (c.table === "user_events") return { data: h.revocation ? { event_data: { event: h.revocation } } : null };
  if (c.table === "users") return { data: { tier: h.access ? "pro" : "free", tier_expires_at: h.access ? "2026-11-14T00:00:00Z" : null } };
  if (c.table === "payment_events") return { data: { plan_id: "plan_redacted8f2b848b" } };
  return {};
}).sb }));
import { GET } from "@/app/api/user/subscription/route";
const run = async () => (await GET(new NextRequest("https://medpruf.com/api/user/subscription"))).json();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  h.revocation = null; h.activeRow = true; h.status = "active"; h.access = true;
  h.provider = { billing_cadence: "auto_renews", provider_status: "active", next_charge_at: "2026-11-12T00:00:00Z", next_charge_amount_cents: 1772, provider_state_verified: true };
});
afterEach(() => vi.useRealTimers());
describe("subscription API billing", () => {
  it("returns the actual access expiry separately from the provider date and amount", async () => {
    expect((await run()).subscription).toMatchObject({ expires_at: "2026-11-14T00:00:00Z", next_charge_at: "2026-11-12T00:00:00Z", next_charge_amount_cents: 1772, billing_cadence_unknown: false });
  });
  it.each(["refunded", "chargeback", "expired", "cancelled"])("keeps %s visible after access has ended", async status => {
    h.activeRow = false; h.access = false; h.status = status;
    const body = await run();
    expect(body.active).toBe(false); expect(body.subscription.status).toBe(status); expect(body.subscription.access_active).toBe(false);
  });
  it("distinguishes a chargeback stored under the ledger refunded status", async () => {
    h.activeRow = false; h.access = false; h.status = "refunded"; h.revocation = "dispute.created";
    expect((await run()).subscription).toMatchObject({ status: "chargeback", revocation_reason: "chargeback" });
  });
  it("keeps reversal reason unknown if the exact webhook evidence is missing", async () => {
    h.activeRow = false; h.access = false; h.status = "refunded";
    expect((await run()).subscription.revocation_reason).toBe("unknown");
  });
  it("returns unknown billing without guessing from subscription or access expiry", async () => {
    h.provider = { billing_cadence: "unknown", provider_status: null, next_charge_at: null, next_charge_amount_cents: null, provider_state_verified: false };
    expect((await run()).subscription).toMatchObject({ billing_cadence_unknown: true, next_charge_at: null, next_charge_amount_cents: null });
  });
});
