import { afterEach, describe, expect, it, vi } from "vitest";
import { billingAccountSentence } from "@/lib/billing-copy";
import { shortSubscriptionLabel, subscriptionBillingState, type SubscriptionCardSnapshot } from "@/lib/subscription-display";
import { parseWhopBillingSnapshot, safeWhopManageUrl, unknownBillingSnapshot } from "@/lib/whop-subscription-snapshot";
const base: SubscriptionCardSnapshot = {
  tier: "first_month_19", tier_human_name: "Pro", tier_human_name_de: "Pro", status: "active", expires_at: "2026-11-14T12:00:00Z",
  access_active: true, days_remaining: 30, payment_provider: "whop", billing_cadence: "auto_renews", provider_status: "active",
  provider_state_verified: true, is_trial: false, cancel_at_period_end: false, next_charge_at: "2026-11-12T12:00:00Z",
  next_charge_amount_cents: 1772, billing_interval_days: 30, manage_url: "https://whop.com/billing/manage/mem_a",
};
const member = { id: "mem_a", plan: { id: "plan_redacted8f2b848b" }, status: "trialing", currency: "eur", formatted_renewal_price: "€17.72 / month", renewal_period_end: "2026-10-13T12:00:00Z", manage_url: base.manage_url };
afterEach(() => vi.useRealTimers());
describe("provider billing snapshot", () => {
  it("keeps exact member amount, provider date and real trial status", () => {
    expect(parseWhopBillingSnapshot(member, { membershipId: "mem_a", tier: "notes_pro_trial" })).toMatchObject({ is_trial: true, next_charge_amount_cents: 1772, next_charge_at: new Date(member.renewal_period_end).toISOString(), billing_interval_days: 30 });
  });
  it("rejects mismatched membership and unsafe manage URLs", () => {
    expect(parseWhopBillingSnapshot(member, { membershipId: "mem_b", tier: "notes_pro_trial" })).toBeNull();
    for (const value of ["https://evil.example/", "https://whop.com.evil.example/billing/manage/mem_a", "javascript:alert(1)", "https://user@whop.com/billing/manage/mem_a", "https://whop.com/medpruf"]) expect(safeWhopManageUrl(value)).toBeNull();
  });
  it.each([{ cancel_at_period_end: true }, { status: "past_due" }, { payment_collection_paused: true }])("does not invent a charge for %j", patch => {
    expect(parseWhopBillingSnapshot({ ...member, ...patch }, { membershipId: "mem_a", tier: "notes_pro_trial" })).toMatchObject({ next_charge_at: null, next_charge_amount_cents: null });
  });
  it("does not parse ambiguous currency, grouping or unknown plan as a recurring charge", () => {
    for (const patch of [{ currency: "usd" }, { formatted_renewal_price: "€1,900.00 / month" }, { plan: { id: "plan_unknown" }, status: "active" }]) {
      expect(parseWhopBillingSnapshot({ ...member, ...patch }, { membershipId: "mem_a", tier: "first_month_19" })?.next_charge_amount_cents).toBeNull();
    }
  });
  it("never derives a charge date from local access expiry", () => {
    expect(unknownBillingSnapshot({ tier: "first_month_19", payment_provider: "whop" })).toMatchObject({ billing_cadence: "unknown", next_charge_at: null, next_charge_amount_cents: null });
  });
});
describe("personal subscription sentence matrix", () => {
  it.each([
    ["active", {}, "Verlängert sich"], ["trial", { is_trial: true }, "Pro-Test bis"],
    ["cancelled", { cancel_at_period_end: true }, "Gekündigt"], ["past_due", { provider_status: "past_due" }, "Zahlung überfällig"],
    ["refunded", { status: "refunded", access_active: false }, "Zahlung erstattet"], ["chargeback", { status: "chargeback", access_active: false }, "Zahlung zurückgebucht"],
    ["expired", { status: "expired", access_active: false }, "abgelaufen"], ["unknown", { billing_cadence: "unknown", next_charge_at: null }, "sobald sie vorliegen"],
  ] as const)("renders %s accurately", (state, patch, text) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const row = { ...base, ...patch };
    expect(subscriptionBillingState(row)).toBe(state);
    expect(billingAccountSentence(row, "de")).toContain(text);
    expect(billingAccountSentence(row, "en")).not.toMatch(/[\u2013\u2014]/);
  });
  it("shows provider charge and access end independently", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const text = billingAccountSentence(base, "de");
    expect(text).toContain("12. November 2026"); expect(text).toContain("17,72 €"); expect(text).not.toContain("14. November");
    expect(billingAccountSentence({ ...base, next_charge_at: null }, "de")).not.toContain("verlängert");
  });
  it("gives one-time access text and seven-day ending chip, no stale guarantee label", () => {
    const row = { ...base, tier: "premium_pass_guaranteed", billing_cadence: "one_time" as const, days_remaining: 7 };
    expect(subscriptionBillingState(row)).toBe("ending");
    expect(billingAccountSentence(row, "de")).toContain("verlängert sich nicht");
    expect(shortSubscriptionLabel(row, "de")).toBe("Prüfungs-Kohorte");
  });
});
