import { describe, expect, it } from "vitest";
import { PENDING_GUARD_MS, noPaymentSettledOnPage, verifyOutcome } from "@/lib/checkout-return";
import { CHECKOUT_SETTLE_MS, noPaymentSettled, pendingCheckout, shouldRecordVerifiedAbsent } from "@/lib/checkout-pending";

describe("checkout return outcome (issue 7)", () => {
  it("a no-payment answer is its own state, never pending or success", () => {
    expect(verifyOutcome(true, { granted: false, reason: "membership_not_found" })).toBe("no_payment");
  });
  it("payment_not_found (Whop shows a valid membership) stays pending, never 'no payment' (review P1)", () => {
    expect(verifyOutcome(true, { granted: false, reason: "payment_not_found", settled: false })).toBe("pending");
  });
  it("a provider or database failure never claims there was no payment", () => {
    for (const reason of ["provider_unavailable", "db_error", "error"]) expect(verifyOutcome(true, { granted: false, reason })).toBe("failed");
    expect(verifyOutcome(false, { reason: "membership_not_found" })).toBe("failed");
  });
  it("granted, unmatched and the in-flight reasons keep their states", () => {
    expect(verifyOutcome(true, { granted: true })).toBe("granted");
    expect(verifyOutcome(true, { reason: "payment_unmatched" })).toBe("unmatched");
    expect(verifyOutcome(true, { reason: "entitlement_pending" })).toBe("pending");
    expect(verifyOutcome(true, { reason: "extension_pending" })).toBe("pending");
  });
  it("the page trusts the server's settled flag and otherwise waits the settle window", () => {
    expect(noPaymentSettledOnPage(true, null)).toBe(true);
    expect(noPaymentSettledOnPage(false, 0, 10 ** 12)).toBe(false);
    expect(noPaymentSettledOnPage(undefined, 1000, 1000 + CHECKOUT_SETTLE_MS - 1)).toBe(false);
    expect(noPaymentSettledOnPage(undefined, 1000, 1000 + CHECKOUT_SETTLE_MS)).toBe(true);
    expect(noPaymentSettledOnPage(undefined, null, 10 ** 12)).toBe(false);
    expect(noPaymentSettledOnPage(null, 1000, 1000 + CHECKOUT_SETTLE_MS)).toBe(true);
    // Trial: the page waits the full /pricing guard window before offering "try again".
    expect(noPaymentSettledOnPage(undefined, 1000, 1000 + CHECKOUT_SETTLE_MS, PENDING_GUARD_MS)).toBe(false);
    expect(noPaymentSettledOnPage(undefined, 1000, 1000 + PENDING_GUARD_MS, PENDING_GUARD_MS)).toBe(true);
  });
});

describe("settled agrees with the second-checkout guard (issue 7)", () => {
  const at = Date.parse("2026-10-12T15:21:39Z");
  const redirect = { event: "checkout_redirected", created_at: new Date(at).toISOString(), tier: "first_month_19" };
  const recorded = { event: "checkout_failed", reason: "verified_payment_not_found", tier: "first_month_19", created_at: new Date(at + CHECKOUT_SETTLE_MS).toISOString() };
  it("not settled until the guard-release row exists", () => {
    expect(noPaymentSettled([redirect], "first_month_19")).toBe(false);
    expect(shouldRecordVerifiedAbsent([redirect], "first_month_19", at + CHECKOUT_SETTLE_MS)).toBe(true);
  });
  it("settled exactly when /pricing no longer holds the buyer", () => {
    expect(pendingCheckout([redirect, recorded], at + CHECKOUT_SETTLE_MS + 1000)).toBeNull();
    expect(noPaymentSettled([redirect, recorded], "first_month_19")).toBe(true);
  });
  it("an early release row (inside the settle window) does not count", () => {
    const early = { ...recorded, created_at: new Date(at + 60_000).toISOString() };
    expect(noPaymentSettled([redirect, early], "first_month_19")).toBe(false);
  });
  it("no redirect row for the tier: unknown (null), the page waits its own window", () => {
    expect(noPaymentSettled([redirect], "first_3mo_27")).toBeNull();
  });
});
