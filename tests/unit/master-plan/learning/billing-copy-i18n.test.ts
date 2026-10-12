import { describe, expect, it } from "vitest";
import {
  BILLING_I18N,
  BILLING_KEYS,
  billingCancelSummaryI18n,
  billingNeutralLineI18n,
  billingPlansSummaryI18n,
  billingRefundSummaryI18n,
  billingTrialSummaryI18n,
  billingWhopEnglishNoteI18n,
  missingBillingKeys,
  type BillingI18nLang,
} from "@/lib/master-learning/billing-copy-i18n";

const LANGS: BillingI18nLang[] = ["ru", "uk", "tr"];

describe("billing copy i18n", () => {
  for (const lang of LANGS) {
    it(`${lang}: money facts, the Whop address and the quoted button are present`, () => {
      const plans = billingPlansSummaryI18n(lang);
      expect(plans).toMatch(/\b19\b/);
      expect(plans).toMatch(/\b49\b/);
      expect(plans).toMatch(/\b129\b/);
      expect(plans).toMatch(/\b30\b/);
      expect(plans).toMatch(/\b90\b/);
      expect(billingTrialSummaryI18n(lang)).toMatch(/\b7\b/);
      expect(billingTrialSummaryI18n(lang)).toMatch(/\b19\b/);
      expect(billingCancelSummaryI18n(lang)).toContain("Cancel membership");
      expect(billingCancelSummaryI18n(lang)).toContain("whop.com/@me/settings/memberships");
      expect(billingWhopEnglishNoteI18n(lang)).toContain("Cancel membership");
      expect(billingRefundSummaryI18n(lang)).toMatch(/\b7\b/);
      expect(billingNeutralLineI18n(lang).length).toBeGreaterThan(20);
    });

    it(`${lang}: no em dash, no en dash and no Arabic script`, () => {
      for (const k of BILLING_KEYS) {
        expect(BILLING_I18N[lang][k]).not.toMatch(/[\u2013\u2014]/);
        expect(BILLING_I18N[lang][k]).not.toMatch(/[\u0600-\u06FF]/);
      }
    });

    it(`${lang}: no key of the minimum set is missing`, () => {
      expect(missingBillingKeys(lang)).toEqual([]);
    });
  }

  it("Arabic stays empty until [name] signs it off, and the check notices", () => {
    expect(missingBillingKeys("ar")).toEqual([...BILLING_KEYS]);
  });

  it("the key-set check fails when a language loses a key", () => {
    const saved = BILLING_I18N.ru.refund;
    BILLING_I18N.ru.refund = "";
    try {
      expect(missingBillingKeys("ru")).toEqual(["refund"]);
    } finally {
      BILLING_I18N.ru.refund = saved;
    }
  });
});
