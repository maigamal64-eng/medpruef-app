/** a-trial-checkout-1104: decline release, strip states, mail copy, /pricing spam line. */
import { describe, expect, it } from "vitest";
import { pendingCheckout, declinedTrialAfterRedirect, noPaymentSettled, type CheckoutEvent } from "@/lib/checkout-pending";
import { buildDeclineHelpMail, firstPurchaseHoldEnabled, isFirstPurchaseFailure } from "@/lib/decline-help-mail";
import { buildDunningMail } from "@/lib/dunning-mail";
import { evaluateCheckoutWatch } from "@/lib/checkout-failure-rate";
import { t } from "@/lib/i18n";

const T0 = Date.parse("2026-11-05T10:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const redirect: CheckoutEvent = { event: "checkout_redirected", created_at: at(0), tier: "flex_month_trial" };
const declined: CheckoutEvent = { event: "checkout_failed", created_at: at(2), tier: "flex_month_trial", reason: "card_declined" };

describe("pending state after a declined card trial", () => {
  it("is pending before the decline and released the moment it is written", () => {
    expect(pendingCheckout([redirect], T0 + 60_000)).not.toBeNull();
    expect(pendingCheckout([redirect, declined], T0 + 3 * 60_000)).toBeNull();
  });
  it("the page says no payment arrived at once (settled), without waiting the settle window", () => {
    expect(noPaymentSettled([redirect, declined], "flex_month_trial")).toBe(true);
    expect(noPaymentSettled([redirect], "flex_month_trial")).toBe(false);
  });
  it("a decline of another tier or before the redirect does not release", () => {
    expect(pendingCheckout([redirect, { ...declined, tier: "flex_month" }], T0 + 3 * 60_000)).not.toBeNull();
    expect(pendingCheckout([redirect, { ...declined, created_at: at(-5) }], T0 + 3 * 60_000)).not.toBeNull();
  });
  it("a new attempt after the decline is pending again, and the strip no longer shows the decline", () => {
    const again = { ...redirect, created_at: at(10) };
    expect(pendingCheckout([redirect, declined, again], T0 + 11 * 60_000)).not.toBeNull();
    expect(declinedTrialAfterRedirect([redirect, declined, again], T0 + 11 * 60_000)).toBeNull();
  });
});

describe("declinedTrialAfterRedirect (strip state)", () => {
  it("names the card tier when the latest redirect was declined", () => {
    expect(declinedTrialAfterRedirect([redirect, declined], T0 + 5 * 60_000)).toBe("flex_month_trial");
  });
  it("null when a grant followed, when nothing was declined, and after 24 hours", () => {
    expect(declinedTrialAfterRedirect([redirect, declined, { event: "grant_succeeded", created_at: at(4), tier: "flex_month" }], T0 + 5 * 60_000)).toBeNull();
    expect(declinedTrialAfterRedirect([redirect], T0 + 5 * 60_000)).toBeNull();
    expect(declinedTrialAfterRedirect([redirect, declined], T0 + 25 * 3600_000)).toBeNull();
  });
});

describe("decline is not a checkout failure for the watch", () => {
  it("card_declined rows do not count as failures", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ event: "checkout_failed", created_at: new Date(T0 - i * 60_000).toISOString(), reason: "card_declined", user_id: `u${i}`, tier: "flex_month_trial" }));
    expect(evaluateCheckoutWatch(rows as never, T0).alert).toBe(false);
  });
});

describe("first purchase rule", () => {
  it("subscription_create and a free learner without a reason are first purchases; renewals are not", () => {
    expect(isFirstPurchaseFailure({ billingReason: "subscription_create", userTier: "pro" })).toBe(true);
    expect(isFirstPurchaseFailure({ billingReason: null, userTier: "free" })).toBe(true);
    expect(isFirstPurchaseFailure({ billingReason: null, userTier: "pro" })).toBe(false);
    expect(isFirstPurchaseFailure({ billingReason: "subscription_cycle", userTier: "free" })).toBe(false);
  });
  it("the hold flag is default off", () => {
    expect(firstPurchaseHoldEnabled({})).toBe(false);
    expect(firstPurchaseHoldEnabled({ DUNNING_FIRST_HOLD_ENABLED: "true" })).toBe(true);
  });
});

describe("decline-help mail: two choices, price last, no em dash", () => {
  for (const isDe of [true, false]) {
    it(isDe ? "DE" : "EN", () => {
      const { html } = buildDeclineHelpMail({ isDe, firstName: "Anna" });
      expect(html).not.toMatch(/—|!/);
      expect(html).toContain("pricing#pro-test");
      expect(html).toContain("pricing#plans");
      expect(html).toContain(isDe ? "24 € alle 30 Tage" : "24 € every 30 days");
      expect(html.indexOf("pricing#pro-test")).toBeLessThan(html.indexOf("24 €"));
    });
  }
});

describe("dunning mail builder keeps the renewal copy", () => {
  it("recovery link variant", () => {
    const m = buildDunningMail({ isDe: true, firstName: null, declineCode: "insufficient_funds", recoveryUrl: "https://whop.com/r/1", actionUrl: "https://whop.com/r/1" });
    expect(m.subject).toBe("Aktion erforderlich: Ihre MedPrüf-Zahlung");
    expect(m.html).toContain("Zahlung jetzt abschließen");
    expect(m.html).toContain("insufficient_funds");
  });
});

describe("/pricing spam line", () => {
  it("exists in DE and EN, mentions the code and spam, no em dash", () => {
    for (const lang of ["de", "en"] as const) {
      const line = t("checkout_code_spam_line", lang);
      expect(line).toMatch(/Spam|spam/);
      expect(line).not.toMatch(/—/);
    }
    expect(t("checkout_code_spam_line", "de")).toContain("Bestätigungscode");
  });
});
