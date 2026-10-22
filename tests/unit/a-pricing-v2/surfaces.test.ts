import { afterEach, describe, expect, it } from "vitest";
import { billingPlansSummary, billingSurfaceText, billingTrialSummary, billingFreeOffer } from "@/lib/billing-copy";
import { LLMS_FULL_V1_PAID, LLMS_V1_PAID, renderLlmsFullTxt, renderLlmsTxt, v2PaidSentence } from "@/lib/agent-docs/render-llms";
import { LLMS_TXT_BASE } from "@/lib/agent-docs/llms-txt";
import { LLMS_FULL_TXT_BASE } from "@/lib/agent-docs/llms-full-txt";
import { v2JsonLdOffers } from "@/lib/pricing-v2/structured";
import { planFacts, confirmLines, CADENCE_DAYS } from "@/app/pricing/_parts/plans";
import { planIncludedGrants, TIER_TO_INCLUDED, type EntitlementSnapshot, type IncludedPackageRow } from "@/lib/mentor/credits/included";
import { ticketEndingMail, halfYearRenewalMail, halfYearStoppedMail } from "@/lib/pricing-v2/emails";
import { V2_TIERS } from "@/lib/pricing-v2/offer";
import type { MentorPackageId } from "@/lib/mentor/contract";

const EM = /[–—]/;
const DU = /\b(du|dein|deine|dich|dir)\b/i;
afterEach(() => { delete process.env.NEXT_PUBLIC_PRICING_V2; delete process.env.NEXT_PUBLIC_REVERSE_TRIAL; });

describe("flag off: today's sentences, byte for byte", () => {
  it("plans summary, surfaces and agent files are unchanged", () => {
    expect(billingPlansSummary("de")).toMatch(/Einzelmonat \(19 € pro Monat\)/);
    expect(billingSurfaceText("surface_27", "de")).toMatch(/49 € pro Quartal/);
    expect(billingSurfaceText("surface_0", "de")).toMatch(/ab 19 € pro Monat/);
    expect(billingTrialSummary("de")).toMatch(/hinterlegter Karte/);
    expect(billingFreeOffer("de")).toMatch(/Pro ab 19 € pro Monat/);
    expect(renderLlmsTxt({})).toBe(LLMS_TXT_BASE);
    expect(renderLlmsFullTxt(false)).toBe(LLMS_FULL_TXT_BASE);
  });
});

describe("flag on: the v2 offer everywhere", () => {
  it("every money sentence names the v2 plans, no placeholder left, no em dash, Sie", () => {
    process.env.NEXT_PUBLIC_PRICING_V2 = "true";
    const keys = ["surface_0", "surface_1", "surface_2", "surface_3", "surface_9", "surface_11", "surface_12", "surface_27", "surface_28", "surface_31", "surface_32",
      "pharmakologie_pruefung_wien_page_tsx_0", "pharmakologie_pruefung_wien_page_tsx_3", "pharmakologie_pruefung_wien_page_tsx_4", "pharmakologie_pruefung_wien_layout_tsx_0"] as const;
    for (const key of keys) {
      for (const lang of ["de", "en"] as const) {
        const text = billingSurfaceText(key, lang);
        expect(text, key).not.toMatch(/\{\w+\}/);
        expect(text, key).not.toMatch(EM);
        expect(text, key).not.toMatch(/49 €|129 €|Kohorte|Cohort/);
        if (lang === "de") expect(text, key).not.toMatch(DU);
      }
    }
    expect(billingSurfaceText("surface_0", "de")).toMatch(/ab 24 € pro Monat/);
    // a-v2-copy-surfaces-1021: the 6-month clause only while that plan is on sale.
    expect(billingSurfaceText("surface_27", "de", { halfYear: true })).toMatch(/Prüfungspass \(59 €.*6-Monats-Tarif \(100 €.*Garantie-Ticket \(179 €/);
    expect(billingSurfaceText("surface_27", "de", { halfYear: false })).toMatch(/Prüfungspass \(59 €.*Garantie-Ticket \(179 €/);
    expect(billingSurfaceText("surface_27", "de", { halfYear: false })).not.toMatch(/6-Monats/);
    // The card trial keeps its own Whop plan price.
    expect(billingSurfaceText("surface_11", "de")).toMatch(/19 € pro Monat/);
    for (const lang of ["de", "en"] as const) {
      const sum = billingPlansSummary(lang);
      expect(sum).toMatch(/24 €/); expect(sum).toMatch(/59 €/); expect(sum).toMatch(/100 €/); expect(sum).toMatch(/179 €/);
      expect(sum).not.toMatch(EM);
    }
    expect(billingFreeOffer("de")).toMatch(/Pro ab 24 € pro Monat/);
  });

  it("reverse-trial copy states no card and that trial answers count", () => {
    process.env.NEXT_PUBLIC_REVERSE_TRIAL = "true";
    expect(billingTrialSummary("de")).toMatch(/3 Tage vollen Zugang, ohne Karte/);
    expect(billingTrialSummary("de")).toMatch(/werden darauf angerechnet/); // Lektor, a-pricing-v2-fit
    expect(billingTrialSummary("en")).toMatch(/Nothing is charged/);
  });

  it("agent files swap exactly the v1 price sentence and stay silent about the Mentor", () => {
    expect(LLMS_TXT_BASE).toContain(LLMS_V1_PAID);
    expect(LLMS_FULL_TXT_BASE).toContain(LLMS_FULL_V1_PAID);
    const v2 = renderLlmsTxt({}, true);
    expect(v2).toContain(v2PaidSentence());
    expect(v2).not.toContain("€129");
    expect(renderLlmsFullTxt(true)).toContain("Guarantee Ticket at €179");
    expect(v2PaidSentence()).not.toMatch(/mentor/i);
  });

  it("JSON-LD lists the four v2 plans at their prices, without the Mentor", () => {
    // a-flip-jsonld-privacy-1018: only plans checkout can sell are listed; make all four ready.
    const offers = v2JsonLdOffers({ HALF_YEAR_AUTO_STOP_ENABLED: "true", HALF_YEAR_AUTO_STOP_DRY_RUN: "false", HALF_YEAR_REMINDER_EMAILS_ENABLED: "true", TICKET_RENEWAL_ENABLED: "true", TICKET_REMINDER_EMAILS_ENABLED: "true", AI_FEATURES_ENABLED: "true", MENTOR_ENABLED: "true", MENTOR_ACCESS_SCOPE: "signed_in", MENTOR_INCLUDED_RAISE_ENABLED: "true" });
    expect(offers.map((o) => [o.name, o.price])).toEqual([["Monthly plan", "24"], ["Sitting Pass", "59"], ["6 months", "100"], ["Guarantee Ticket", "179"]]);
    expect(JSON.stringify(offers)).not.toMatch(/mentor/i);
  });
});

describe("plan cards and confirm lines", () => {
  it("every v2 card states the charge, the renewal rule and the cancel rule in Sie without em dashes", () => {
    for (const tier of V2_TIERS) {
      for (const lang of ["de", "en"] as const) {
        const f = planFacts(tier, lang);
        const all = Object.values(f).join(" ");
        expect(all).not.toMatch(EM);
        if (lang === "de") expect(all).not.toMatch(DU);
      }
    }
    expect(planFacts("half_year", "de").renewal).toMatch(/alle 180 Tage mit 100 €.*Prüfungstermin vorbei.*verlängert er sich nicht mehr.*7 Tage vor jeder Verlängerung/);
    expect(planFacts("sitting_pass", "de").renewal).toMatch(/mindestens 30 Tage, höchstens 3 Monate/);
    expect(planFacts("guarantee_ticket", "de").perMonth).toBe("entspricht rund 14,92 € pro Monat");
    expect(CADENCE_DAYS.half_year).toBe(180);
  });
  it("the Sitting Pass confirm sheet names its end from the chosen sitting", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    expect(confirmLines("sitting_pass", "de", now, null, "2026-12-10").join(" ")).toMatch(/Zugang bis 12\. Dezember 2026/);
    expect(confirmLines("half_year", "de", now).join(" ")).toMatch(/danach alle 180 Tage/);
    expect(confirmLines("guarantee_ticket", "en", now).join(" ")).toMatch(/Access until 20 October 2027/);
  });
});

describe("Mentor credits: the ticket at the Cohort level, the other v2 plans as Pro", () => {
  const pkg = (id: MentorPackageId): IncludedPackageRow => ({ package_id: id, grant_micro: 1_000_000, expiry_days: 30, active: true });
  const packages = new Map<MentorPackageId, IncludedPackageRow>(["included_pro_monthly", "included_pro_quarterly", "included_cohort", "trial_taste", "included_unknown"].map((id) => [id as MentorPackageId, pkg(id as MentorPackageId)]));
  const now = new Date("2026-10-20T10:00:00Z");
  const snap = (tier: string, provider = "whop"): EntitlementSnapshot => ({
    user: { id: "u1", role: "user", tier: "pro", tier_expires_at: "2027-10-20T00:00:00Z" },
    subs: [{ id: "s1", tier, status: "active", payment_provider: provider, amount_cents: provider === "trial" ? 0 : 17900, started_at: "2026-10-19T00:00:00Z", expires_at: "2027-10-20T00:00:00Z" }],
    referrals: [], packages, freeEnabled: false,
  });
  it("maps every v2 tier, never to included_unknown", () => {
    expect(TIER_TO_INCLUDED.guarantee_ticket).toBe("included_cohort");
    for (const t of V2_TIERS) expect(TIER_TO_INCLUDED[t]).toBeTruthy();
    expect(planIncludedGrants(snap("guarantee_ticket"), now)[0].packageId).toBe("included_cohort");
    expect(planIncludedGrants(snap("flex_month"), now)[0].packageId).toBe("included_pro_monthly");
    expect(planIncludedGrants(snap("half_year"), now)[0].packageId).toBe("included_pro_quarterly");
    // The reverse trial is a trial row: only the bounded trial taste.
    expect(planIncludedGrants(snap("reverse_trial", "trial"), now)[0].packageId).toBe("trial_taste");
  });
});

describe("reminder mails", () => {
  it("ticket and 6-month mails: Sie, no em dashes, links escaped", () => {
    const t = ticketEndingMail({ lang: "de", endsAt: "2027-10-20T10:00:00Z", renewalsUsed: 1, formUrl: "https://medpruf.com/ticket-renewal?a=1&b=2" });
    expect(t.subject).toBe("MedPrüf: Ihr Garantie-Ticket endet am 20. Oktober 2027");
    expect(t.htmlBody).toMatch(/ein kostenloses Verlängerungsjahr/);
    expect(t.htmlBody).toContain("a=1&amp;b=2");
    expect(ticketEndingMail({ lang: "de", endsAt: "2027-10-20T10:00:00Z", renewalsUsed: 2, formUrl: "x" }).htmlBody).toMatch(/beide kostenlosen/);
    const hmail = halfYearRenewalMail({ lang: "de", chargeAt: "2027-04-18T10:00:00Z", amountCents: 10000, manageUrl: null });
    expect(hmail.htmlBody).toMatch(/18\. April 2027 mit 100 €/);
    const stopped = halfYearStoppedMail({ lang: "de", accessUntil: "2027-08-01T00:00:00Z" });
    expect(stopped.htmlBody).toMatch(/Es wird nichts mehr abgebucht/);
    for (const m of [t, hmail, stopped]) { expect(m.htmlBody).not.toMatch(EM); expect(m.htmlBody).not.toMatch(DU); }
  });
});
