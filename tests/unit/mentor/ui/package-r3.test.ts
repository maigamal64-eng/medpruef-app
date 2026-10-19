import { describe, expect, it, vi } from "vitest";
import { FIXTURE_PACKAGES, FIXTURE_USAGE_PRO_INCLUDED } from "@/lib/mentor/fixtures";
import { CHECKOUT_RECOVERY_MS, perCreditSaving, subscribeCheckoutRestore } from "@/components/mentor/r3-package-state";
import { r3PackageCopy, R3_PACKAGE_AR_STATUS } from "@/components/mentor/r3-package-copy";
import { formatCreditBalance, usageView, errorView } from "@/components/mentor/view-model";

const basis = FIXTURE_PACKAGES.packages.find(o => o.package_id === "mentor_basis")!;
const plus = FIXTURE_PACKAGES.packages.find(o => o.package_id === "mentor_plus")!;
describe("R3 package comparison and checkout recovery", () => {
  it("derives the 24 percent saving from 9.90/400 versus 4.90/150", () => {
    expect(perCreditSaving({ ...basis, price_eur_cents: 490, credits: 150 }, { ...plus, price_eur_cents: 990, credits: 400 })).toBe(24);
    expect(perCreditSaving({ ...basis, price_eur_cents: 800, credits: 100 }, { ...plus, price_eur_cents: 400, credits: 100 })).toBe(50);
    expect(perCreditSaving(basis, { ...plus, price_eur_cents: 100_000 })).toBeNull();
    expect(perCreditSaving(undefined, plus)).toBeNull();
    expect(perCreditSaving(basis, { ...plus, credits: Number.NaN })).toBeNull();
  });
  it("resets only a persisted pageshow and unregisters on unmount", () => {
    const target = new EventTarget(); const reset = vi.fn();
    const unsubscribe = subscribeCheckoutRestore(target as unknown as Window, reset);
    target.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    expect(reset).not.toHaveBeenCalled();
    target.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(reset).toHaveBeenCalledOnce();
    unsubscribe();
    target.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(reset).toHaveBeenCalledOnce();
    expect(CHECKOUT_RECOVERY_MS).toBe(15_000);
  });
  it("keeps factual savings, specific errors and Arabic drafts inactive", () => {
    expect(r3PackageCopy("saving", "de", { percent: 24 })).toBe("24 Prozent günstiger pro Credit");
    expect(r3PackageCopy("upstream_error", "en")).toContain("nothing was charged");
    expect(R3_PACKAGE_AR_STATUS).toBe("needs [name] sign-off");
    expect(r3PackageCopy("trialExpired", "ar")).toBe(r3PackageCopy("trialExpired", "en"));
    for (const lang of ["en", "de", "ru", "uk", "tr", "ar"] as const) expect(r3PackageCopy("best", lang)).not.toMatch(/Beliebt|Popular|[–—]/);
  });
});
describe("R3 trial label and verifiable fractional balance", () => {
  it("shows one localized decimal under twenty and hides exhausted cost details", () => {
    for (const lang of ["de", "ru", "uk", "tr"] as const) expect(formatCreditBalance(11.8, lang)).toBe("11,8");
    expect(formatCreditBalance(0.9, "en")).toBe("0.9");
    expect(formatCreditBalance(20, "en")).toBe("20");
    expect(usageView({ ...FIXTURE_USAGE_PRO_INCLUDED, state: "exhausted", credits_left: 0.9 }, "en").hideCostDetails).toBe(true);
  });
  it("reads the trial grant amount and expiry rather than copying a fixed twenty", () => {
    const usage = { ...FIXTURE_USAGE_PRO_INCLUDED, trial: { credits: 27, credits_left: 11.8, pro_included_credits: 70, expires_at: "2026-10-12T18:00:00Z", expired: false } };
    const view = usageView(usage, "en", new Date("2026-10-11T12:00:00Z"));
    expect(view.creditsText).toBe("Trial: 27 credits until 12 October 2026");
    expect(view.tone).toBe("trial");
    expect(view.trialNoticeText).toContain("Your trial ends tomorrow");
    expect(view.trialNoticeText).toContain("70 AI Mentor credits");
    const expired = usageView({ ...usage, trial: { ...usage.trial, expired: true } }, "en", new Date("2026-10-13"));
    expect(expired.creditsText).not.toContain("Trial:");
    expect(expired.trialNoticeText).toContain("Your mentor trial is over");
  });
  it("maps distinct errors to their correct actions", () => {
    expect(errorView("invalid_input", { reason: "question_access" })).toMatchObject({ messageKey: "err_question_access", action: "pro" });
    expect(errorView("invalid_input").action).toBe("rephrase");
    expect(errorView("reserve_failed").messageKey).toBe("err_reserve_failed");
    expect(errorView("upstream_error").messageKey).toBe("err_upstream_error");
  });
});
