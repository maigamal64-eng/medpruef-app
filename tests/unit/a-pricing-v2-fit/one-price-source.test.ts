/**
 * a-pricing-v2-fit acceptance: one price source. With the v2 offer on, the
 * pricing cards and their totals, the landing preview, llms.txt and
 * llms-full.txt, the root JSON-LD and the access-ending mail all render from
 * content-truth TIERS through price-facts.ts: change a price there and every
 * surface moves together. The returning-payer prices appear only in the
 * learner's own mail (and in-app), never on a public surface.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRICES: Record<string, number> = vi.hoisted(() => ({
  flex_month: 2700, sitting_pass: 6300, half_year: 11100, guarantee_ticket: 18800,
  first_month_19: 2100, first_3mo_27: 5200,
}));
vi.mock("@/lib/content-truth", async (orig) => {
  const o = await orig<typeof import("@/lib/content-truth")>();
  const TIERS = Object.fromEntries(Object.entries(o.TIERS).map(([k, v]) => [k, k in PRICES ? { ...v, price_cents: PRICES[k] } : v]));
  return { ...o, TIERS };
});

import { planFacts } from "@/app/pricing/_parts/plans";
import { fitLines } from "@/app/pricing/_parts/fit-copy";
import { sittingFit } from "@/lib/pricing-v2/fit";
import { v2LandingPreview } from "@/lib/pricing-v2/landing-preview";
import { renderLlmsFullTxt, renderLlmsTxt, v2PaidSentence } from "@/lib/agent-docs/render-llms";
import { v2JsonLdOffers } from "@/lib/pricing-v2/structured";
import { renderAccessEndingReminder } from "@/lib/email/access-ending-template";
import { V2_PLAN_NAMES } from "@/lib/pricing-v2/price-facts";

const V2 = ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"] as const;
const euroDe = (c: number) => `${c / 100} €`;
const euroAgent = (c: number) => `€${c / 100}`;
// Today's real amounts must have gone from every surface.
const OLD_V2 = ["24", "59", "100", "179"];

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true"));
afterEach(() => vi.unstubAllEnvs());

function mail(lang: "de" | "en", returningPrices: boolean) {
  return renderAccessEndingReminder({ firstName: null, lang, accessEndsAtIso: "2026-11-20T10:00:00Z", qsAnswered: 10, accuracyPct: 70, streakDays: 2, now: new Date("2026-11-10T10:00:00Z"), activeExam: "kenntnispruefung", returningPrices }).htmlBody;
}

describe("every v2 surface renders the same facts", () => {
  it("pricing cards, totals, landing, llms, JSON-LD and the mail move with TIERS", () => {
    for (const t of V2) {
      expect(planFacts(t, "de").amount).toBe(euroDe(PRICES[t]));
      expect(planFacts(t, "de").name).toBe(V2_PLAN_NAMES[t].de);
    }
    const fit = sittingFit({ date: "2026-11-17", lastDay: "2026-11-17" }, new Date("2026-10-21T11:00:00Z"), { guard: true });
    expect(fitLines(fit.plans.flex_month, "de")[0]).toContain(`zusammen ${euroDe(PRICES.flex_month)}`);

    const landing = v2LandingPreview();
    const landingText = JSON.stringify(landing);
    for (const t of ["sitting_pass", "half_year", "guarantee_ticket"] as const) expect(landingText).toContain(euroDe(PRICES[t]));
    expect(landing.subtitle.de).toContain(euroDe(PRICES.flex_month));

    const agent = v2PaidSentence();
    for (const t of V2) expect(agent).toContain(euroAgent(PRICES[t]));
    for (const file of [renderLlmsTxt(process.env, true), renderLlmsFullTxt(true)]) {
      for (const t of V2) expect(file).toContain(euroAgent(PRICES[t]));
    }

    // a-flip-jsonld-privacy-1018: only plans checkout can sell are listed; make all four ready.
    const offers = v2JsonLdOffers({ HALF_YEAR_AUTO_STOP_ENABLED: "true", HALF_YEAR_AUTO_STOP_DRY_RUN: "false", HALF_YEAR_REMINDER_EMAILS_ENABLED: "true", TICKET_RENEWAL_ENABLED: "true", TICKET_REMINDER_EMAILS_ENABLED: "true", AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in", MENTOR_INCLUDED_RAISE_ENABLED: "true" });
    expect(offers.map((o) => [o.name, o.price])).toEqual(V2.map((t) => [V2_PLAN_NAMES[t].en, String(PRICES[t] / 100)]));

    for (const lang of ["de", "en"] as const) {
      const body = mail(lang, false);
      for (const t of V2) expect(body).toContain(`<strong>${V2_PLAN_NAMES[t][lang]}</strong>: ${euroDe(PRICES[t])}`);
    }

    // No surface still carries today's amounts.
    for (const text of [landingText, agent, JSON.stringify(offers), mail("de", false)]) {
      for (const old of OLD_V2) expect(text).not.toMatch(new RegExp(`(€${old}\\b|\\b${old} €)`));
    }
  });

  it("returning-payer prices: only in the learner's own mail, price last; never on a public surface", () => {
    const de = mail("de", true);
    expect(de).toContain(`<li><strong>Monatsabo (bisheriger Tarif)</strong>: abgebucht alle 30 Tage, bis Sie kündigen, ${euroDe(PRICES.first_month_19)} pro Monat.</li>`);
    expect(de).toContain(`<li><strong>3 Monate</strong>: abgebucht alle 90 Tage, bis Sie kündigen, ${euroDe(PRICES.first_3mo_27)} für 3 Monate.</li>`);
    expect(mail("en", true)).toContain(`charged every 90 days until you cancel, ${euroDe(PRICES.first_3mo_27)} for 3 months.`);
    expect(mail("de", false)).not.toContain(euroDe(PRICES.first_month_19));
    const publicText = [JSON.stringify(v2LandingPreview()), v2PaidSentence(), renderLlmsTxt(process.env, true), renderLlmsFullTxt(true), JSON.stringify(v2JsonLdOffers({ HALF_YEAR_AUTO_STOP_ENABLED: "true", HALF_YEAR_AUTO_STOP_DRY_RUN: "false", HALF_YEAR_REMINDER_EMAILS_ENABLED: "true", TICKET_RENEWAL_ENABLED: "true", TICKET_REMINDER_EMAILS_ENABLED: "true", AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in", MENTOR_INCLUDED_RAISE_ENABLED: "true" }))].join("\n");
    for (const t of ["first_month_19", "first_3mo_27"]) {
      expect(publicText).not.toContain(euroDe(PRICES[t]));
      expect(publicText).not.toContain(euroAgent(PRICES[t]));
    }
  });
});
