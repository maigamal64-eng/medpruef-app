import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, eqVal } from "../helpers/fake-supabase";
const h = vi.hoisted(() => ({ status: "active", access: true, provider: {} as Record<string, unknown> | null, activeRow: true, revocation: null as string | null, plan: "plan_redacted8f2b848b", rowEnd: "2026-11-14T00:00:00Z" }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: vi.fn() }));
vi.mock("@/lib/billing-cadence", async (orig) => ({ ...(await orig<typeof import("@/lib/billing-cadence")>()), loadRenewalOfferSuppression: async () => ({ suppressed: true }) }));
vi.mock("@/lib/whop-subscription-snapshot", () => ({ loadWhopBillingSnapshot: async () => h.provider, unknownBillingSnapshot: () => ({ billing_cadence: "unknown", next_charge_at: null, next_charge_amount_cents: null }) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => createFakeSupabase(c => {
  if (c.table === "subscriptions") {
    if (!h.activeRow && eqVal(c, "status") === "active") return { data: c.single ? null : [] };
    if (c.columns === "expires_at") return { data: [{ expires_at: h.rowEnd }] };
    const row = { tier: "first_month_19", payment_provider: "whop", provider_payment_id: "pay_a", whop_membership_id: "mem_a" };
    if (!c.single) return { data: [row] };
    return { data: { id: "sub_a", tier: "first_month_19", status: h.status, started_at: "2026-10-01T00:00:00Z", expires_at: "2026-11-12T00:00:00Z", payment_provider: "whop", amount_cents: 1900, currency: "EUR", provider_payment_id: "pay_a", whop_membership_id: "mem_a" } };
  }
  if (c.table === "user_events") return { data: h.revocation ? { event_data: { event: h.revocation } } : null };
  if (c.table === "users") return { data: { tier: h.access ? "pro" : "free", tier_expires_at: h.access ? "2026-11-14T00:00:00Z" : null } };
  if (c.table === "payment_events") return { data: c.single ? { plan_id: h.plan } : [{ payment_id: "pay_a", plan_id: h.plan }] };
  return {};
}).sb }));
import { GET } from "@/app/api/user/subscription/route";
const run = async () => (await GET(new NextRequest("https://medpruf.com/api/user/subscription"))).json();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  h.revocation = null; h.activeRow = true; h.status = "active"; h.access = true; h.plan = "plan_redacted8f2b848b"; h.rowEnd = "2026-11-14T00:00:00Z";
  h.provider = { billing_cadence: "auto_renews", provider_status: "active", next_charge_at: "2026-11-12T00:00:00Z", next_charge_amount_cents: 1772, provider_state_verified: true };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
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
  it("renewal_state is renews only when Whop confirms it; an unread membership is unknown", async () => {
    h.provider = { ...h.provider, billing_cadence: "auto_renews", cancel_at_period_end: false };
    expect(await run()).toMatchObject({ renewal_state: "renews", extension_available: false });
    h.provider = null;
    expect(await run()).toMatchObject({ renewal_state: "unknown", extension_available: false });
  });
  it("extension_available stays false with the flag off, TRUE or 1, and after access ended", async () => {
    h.plan = "plan_redacted324decbc"; h.provider = null;
    for (const flag of ["", "TRUE", "1"]) {
      vi.stubEnv("WHOP_EXTENSIONS_ENABLED", flag);
      expect(await run()).toMatchObject({ renewal_state: "one_time", extension_available: false });
    }
    vi.stubEnv("WHOP_EXTENSIONS_ENABLED", "true");
    expect(await run()).toMatchObject({ renewal_state: "one_time", extension_available: true });
    h.access = false;
    expect((await run()).extension_available).toBe(false);
  });
});
