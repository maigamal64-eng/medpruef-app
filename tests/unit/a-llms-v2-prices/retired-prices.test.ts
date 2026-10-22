import { describe, expect, it } from "vitest";
import { TIERS } from "@/lib/content-truth";
import { LLMS_TXT_BASE } from "@/lib/agent-docs/llms-txt";
import { LLMS_FULL_TXT_BASE } from "@/lib/agent-docs/llms-full-txt";
import { renderLlmsFullTxt, renderLlmsTxt } from "@/lib/agent-docs/render-llms";
import { agentEur, retiredPriceHits } from "@/lib/agent-docs/prices";
import { examReportCopy as rewardsCopy } from "@/lib/rewards-copy";
const READY_ALL: Record<string, string> = { HALF_YEAR_AUTO_STOP_ENABLED: "true", HALF_YEAR_AUTO_STOP_DRY_RUN: "false", HALF_YEAR_REMINDER_EMAILS_ENABLED: "true", TICKET_RENEWAL_ENABLED: "true", TICKET_REMINDER_EMAILS_ENABLED: "true", AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in", MENTOR_INCLUDED_RAISE_ENABLED: "true" }; // a-v2-readiness-surfaces-1020: every v2 plan sellable

const V2 = ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"] as const;
const ANSWERS_ON = { ANSWER_PAGES_ENABLED: "true", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" };

describe("llms files with PRICING_V2_ENABLED on", () => {
  it("carry no retired price, plan name or guarantee wording", () => {
    for (const text of [renderLlmsTxt(READY_ALL, true), renderLlmsTxt({ ...ANSWERS_ON, ...READY_ALL }, true), renderLlmsFullTxt(true, READY_ALL)]) {
      expect(retiredPriceHits(text)).toEqual([]);
      for (const t of V2) expect(text).toContain(agentEur(t));
    }
  });

  it("the guard fails on every retired amount and word", () => {
    expect(retiredPriceHits(renderLlmsTxt({}, false))).toEqual(
      expect.arrayContaining(["first_month_19 (19)", "first_3mo_27 (49)", "premium_pass_guaranteed (129)"]),
    );
    expect(retiredPriceHits(LLMS_FULL_TXT_BASE).length).toBeGreaterThanOrEqual(3);
    for (const bad of ["€19", "€ 49", "129 €", "129 EUR", "EUR 19", "EUR19", "€19.00", "€19,00", "EUR 49.00", "19 euros", "the Cohort plan", "Pass-Until-You-Pass"]) {
      expect(retiredPriceHits(`x ${bad} y`), bad).not.toEqual([]);
    }
    for (const ok of ["€179", "€100", "€24", "€59", "around 19,000 learners", "€190", "19 EUR-Lex", "EUR 190", "2019 EUR"]) expect(retiredPriceHits(ok), ok).toEqual([]);
  });

  it("the flag-off files read their amounts from TIERS", () => {
    for (const t of ["first_month_19", "first_3mo_27", "premium_pass_guaranteed"] as const) {
      expect(LLMS_TXT_BASE).toContain(agentEur(t));
      expect(LLMS_FULL_TXT_BASE).toContain(agentEur(t));
    }
    expect(agentEur("first_month_19")).toBe(`€${TIERS.first_month_19.price_cents / 100}`);
  });
});

describe("free-credit hook copy (Lektor, 16 Oct 2026)", () => {
  it("the report-sent line has no exclamation mark and no em dash", () => {
    for (const lang of ["de", "en"] as const) {
      const sent = rewardsCopy(lang).sent;
      expect(sent).not.toMatch(/[!—–]/);
    }
    expect(rewardsCopy("de").sent).toBe("Danke für Ihren Bericht. Wir lesen ihn durch und schreiben Ihnen die Credits danach gut. Ihr Guthaben sehen Sie beim KI-Mentor.");
  });
});
