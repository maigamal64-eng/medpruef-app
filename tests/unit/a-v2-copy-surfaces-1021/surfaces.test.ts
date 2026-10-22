/**
 * a-v2-copy-surfaces-1021: the surfaces Lektor found on v1 copy after the
 * 21 Oct pricing v2 flip (MEDPRUEF-COPY-AUDIT.md, 2026-10-21 row, items 1
 * to 10) and the Lektor verdict of 21 Oct (B1, D, missed items). v2 lines only
 * under PRICING_V2_ENABLED; flag off keeps today's text except the dropped
 * orientation pass promise.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { billingNeutralLine, billingSurfaceText, V2_RENEWAL_LINE, V2_RENEWAL_LINE_NO_HALF, v2RenewalLine } from "@/lib/billing-copy";
import { faqCancelIntro, faqFreeUpgrade, faqPaymentPlans, faqSchemaEntries } from "@/app/faq/faq-copy";
import { getGateCopy } from "@/lib/paywall-copy";
import { PUYP_COPY, puypNoPlanHref, tp } from "@/lib/i18n-puyp";
import { failHelperKey, failPathFor, isTicketHolder } from "@/app/dashboard/exam-result/_parts/rules";
import { t } from "@/lib/i18n";
import { retiredPriceHits } from "@/lib/agent-docs/prices";
import { safetyNetLine } from "@/app/blog/medizin-lernen-in-deiner-sprache/safety-net";

const root = resolve(__dirname, "../../..");
const src = (p: string) => readFileSync(resolve(root, p), "utf8");
const EM = /[–—]/;
const DU = /\b(du|dein\w*|dich|dir)\b/i;
const v2 = () => vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
const halfYearLive = () => {
  vi.stubEnv("HALF_YEAR_AUTO_STOP_ENABLED", "true");
  vi.stubEnv("HALF_YEAR_AUTO_STOP_DRY_RUN", "false");
  vi.stubEnv("HALF_YEAR_REMINDER_EMAILS_ENABLED", "true");
};
afterEach(() => vi.unstubAllEnvs());

/** Text that names the Cohort as history for members who bought it, not as an offer. */
const HISTORY = [
  "Früher gebuchte Monats- und 3-Monats-Tarife verlängern sich ebenfalls, bis Sie kündigen; die Prüfungs-Kohorte ist eine Einmalzahlung.",
  "Monthly and 3-month plans booked earlier also renew until you cancel; the Exam Cohort is a one-time payment.",
];
const withoutHistory = (text: string) => {
  let out = HISTORY.reduce((acc, h) => acc.split(h).join(""), text);
  // The guarantee answer keeps the PUYP terms for Cohorts already bought.
  const cut = out.search(/Für bereits gekaufte Prüfungs-Kohorten gilt weiterhin:|For Exam Cohorts already bought, this still applies:/);
  if (cut >= 0) {
    const tail = out.slice(cut);
    const next = tail.search(/\n|$/);
    out = out.slice(0, cut) + tail.slice(next);
  }
  return out;
};

describe("flag off: today's v1 text", () => {
  it("neutral line, FAQ and exam-result copy are unchanged", () => {
    expect(billingNeutralLine("de")).toBe("Einzelmonat und 3-Monats-Tarif verlängern sich automatisch bis zur Kündigung. Die Prüfungs-Kohorte ist eine Einmalzahlung.");
    expect(faqCancelIntro("de", false)).toBe(billingNeutralLine("de"));
    expect(faqFreeUpgrade("de")).toMatch(/zur Prüfungs-Kohorte oder zu einem anderen bezahlten Tarif/);
    expect(billingSurfaceText("surface_27", "de", { halfYear: false })).toMatch(/49 € pro Quartal/);
    expect(tp("noPlanNote", "de")).toMatch(/nur mit der Prüfungs-Kohorte/);
    expect(tp("eyebrow", "de")).toBe("Pass-Until-You-Pass");
    expect(puypNoPlanHref()).toBe("/pricing");
    expect(safetyNetLine("de")).toBeNull();
  });
  it("the orientation pass promise is gone for flag off too, in Sie", () => {
    for (const key of ["orient_subtitle", "orient_item1_title", "orient_item1_body", "orient_item1_link", "orient_item2_body"] as const) {
      expect(t(key, "de"), key).not.toMatch(DU);
    }
    expect(t("orient_item1_title", "de")).toBe("Verlängerung auf Nachweis");
    expect(`${t("orient_item1_title", "en")} ${t("orient_item1_body", "en")}`).not.toMatch(/first try|until you do/i);
    expect(t("orient_item1_body", "de")).toMatch(/keine Bestehensgarantie/);
  });
});

describe("flag on: the audit strings, byte for byte", () => {
  it("items 1, 2, 8: neutral line follows the 6-month readiness (Lektor B1)", () => {
    v2();
    expect(V2_RENEWAL_LINE.de).toBe("Monatsabo und 6-Monats-Tarif verlängern sich automatisch, bis Sie kündigen; der 6-Monats-Tarif endet nach Ihrem Prüfungstermin von selbst. Prüfungspass und Garantie-Ticket sind Einmalzahlungen.");
    expect(V2_RENEWAL_LINE_NO_HALF.de).toBe("Das Monatsabo verlängert sich automatisch, bis Sie kündigen. Prüfungspass und Garantie-Ticket sind Einmalzahlungen.");
    expect(V2_RENEWAL_LINE_NO_HALF.en).toBe("The monthly plan renews automatically until you cancel. The Sitting Pass and the Guarantee Ticket are one-time payments.");
    // Server env with the 6-month plan not ready (today) and ready.
    expect(billingNeutralLine("en")).toBe(V2_RENEWAL_LINE_NO_HALF.en);
    expect(billingNeutralLine("de", { halfYear: true })).toBe(V2_RENEWAL_LINE.de);
    halfYearLive();
    expect(billingNeutralLine("de")).toBe(V2_RENEWAL_LINE.de);
    expect(v2RenewalLine("en", false)).toBe(V2_RENEWAL_LINE_NO_HALF.en);
  });
  it("the paywall modal reads the same owner", () => {
    v2();
    const copy = getGateCopy({ lang: "de", gate: "qbank_limit", bankLabel: "Stichprobentest", limit: 150 });
    expect(copy.renewal).toBe(V2_RENEWAL_LINE_NO_HALF.de);
  });
  it("item 1: the cancel answer adds the plans booked earlier", () => {
    v2();
    expect(faqCancelIntro("de", false)).toBe(`${V2_RENEWAL_LINE_NO_HALF.de} ${HISTORY[0]}`);
    expect(faqCancelIntro("en", true)).toBe(`${V2_RENEWAL_LINE.en} ${HISTORY[1]}`);
  });
  it("item 3: free tier upgrade line", () => {
    v2();
    expect(faqFreeUpgrade("de")).toBe("Wenn Sie bereit sind, können Sie zu einem bezahlten Tarif wechseln. Ihr Fortschritt und Ihre Antworten bleiben erhalten.");
    expect(faqFreeUpgrade("en")).toBe("Whenever you are ready, switch to a paid plan. Your progress and answers carry over.");
  });
  it("item 10: FAQ plans answer and terms name the 6-month plan only while it is on sale", () => {
    v2();
    for (const lang of ["de", "en"] as const) {
      const off = faqPaymentPlans(lang, false);
      expect(off).not.toMatch(/6-Monats|6-month|100 €/);
      expect(off).toMatch(/24 €/); expect(off).toMatch(/59 €/); expect(off).toMatch(/179 €/);
      expect(faqPaymentPlans(lang, true)).toMatch(/100 €/);
      const terms = billingSurfaceText(lang === "de" ? "surface_31" : "surface_32", lang, { halfYear: false });
      expect(terms).not.toMatch(/6-Monats|6-month|100 €|Beide Abos|Both subscriptions/);
      expect(terms).not.toMatch(/\{\w+\}/);
      expect(terms).not.toMatch(EM);
      expect(billingSurfaceText(lang === "de" ? "surface_31" : "surface_32", lang, { halfYear: true })).toMatch(/100 €/);
    }
    // Default reads the server env: not ready today, ready once the flags are live.
    expect(billingSurfaceText("surface_27", "de")).not.toMatch(/6-Monats/);
    halfYearLive();
    expect(billingSurfaceText("surface_27", "de")).toMatch(/6-Monats-Tarif \(100 €/);
  });
  it("item 7: exam-result points at the Guarantee Ticket; a ticket holder is sent to the renewal page", () => {
    v2();
    expect(tp("noPlanNote", "de")).toBe("Ihr Ergebnis hilft uns, die Vorbereitung zu verbessern. Eine Verlängerung auf Nachweis gibt es mit dem Garantie-Ticket.");
    expect(tp("noPlanLink", "en")).toBe("See the Guarantee Ticket");
    expect(tp("failHelperNoPlan", "de")).not.toMatch(/Kohorte/);
    expect(tp("eyebrow", "de")).toBe("Prüfungsergebnis");
    expect(puypNoPlanHref()).toBe("/pricing#plan-guarantee-ticket");
    const holder = { eligible: false, reason_code: "tier_not_eligible" as const, subscription: { tier: "guarantee_ticket", expires_at: null, puyp_extensions_used: 0 }, meets_completion_gate: false };
    expect(isTicketHolder(holder)).toBe(true);
    expect(failHelperKey(failPathFor(holder))).toBe("failHelperTicket");
    expect(failHelperKey(failPathFor({ ...holder, subscription: { ...holder.subscription, tier: "flex_month" } }))).toBe("failHelperNoPlan");
    expect(src("src/app/dashboard/exam-result/_parts/ChooseView.tsx")).toMatch(/href="\/ticket-renewal"/);
  });
  it("item 6: orientation modal under v2 names the Ticket and no pass promise", () => {
    v2();
    expect(t("orient_item1_title_v2", "de")).toBe("Verlängerung auf Nachweis");
    expect(t("orient_item1_body_v2", "de")).toBe("Mit dem Garantie-Ticket verlängern wir Ihren Zugang auf Nachweis kostenlos um ein Jahr, höchstens zweimal. Das ist keine Bestehensgarantie.");
    expect(t("orient_item1_body_v2", "en")).toBe("With the Guarantee Ticket we extend your access by one year free of charge on proof, at most twice. It is not a pass guarantee.");
    expect(src("src/components/OrientationModal.tsx")).toMatch(/v2 \? "orient_item1_body_v2" : "orient_item1_body"/);
    // Unreviewed drafts with the pass promise are gone, so those languages read English.
    expect(src("src/lib/i18n-extra.ts")).not.toMatch(/"orient_item1_(title|body)"|"orient_item2_body"/);
  });
  it("items 4, 5, 9 and the pharma image: v2 lines in source", () => {
    const shell = src("src/components/seo/ExamLandingShell.tsx");
    expect(shell).toMatch(/title: \{ de: "Garantie-Ticket", en: "Guarantee Ticket" \}/);
    expect(shell).toMatch(/line: \{ de: "bis zu zwei Verlängerungsjahre auf Nachweis", en: "up to two renewal years on proof" \}/);
    const pharma = src("src/app/pharmakologie-pruefung-wien/page.tsx");
    expect(pharma).toMatch(/\{ de: "Tarife ansehen", en: "See plans" \}/);
    expect(pharma).toContain("Garantie-Ticket: Auf Nachweis eines nicht bestandenen Ergebnisses oder einer Anmeldung zu einem Prüfungstermin nach dem Ende des Tickets verlängern wir es kostenlos um ein Jahr, höchstens zweimal.");
    expect(src("src/app/pharmakologie-pruefung-wien/opengraph-image.tsx")).toMatch(/pricingV2Enabled\(\) \? "Garantie-Ticket\." : "Prüfungs-Kohorte\."/);
    v2();
    expect(safetyNetLine("de")).toMatch(/Garantie-Ticket kostet 179 €/);
    expect(retiredPriceHits(`${safetyNetLine("de")} ${safetyNetLine("en")}`)).toEqual([]);
  });
  it("item 8: the AI-chat 402 reads the neutral line", () => {
    expect(src("src/app/api/ai-chat/route.ts")).toMatch(/AI explanations are part of MedPrüf Pro\. \$\{billingNeutralLine\("en"\)\}/);
  });
});

describe("guard: the FAQ JSON-LD under v2 sells no retired plan", () => {
  for (const halfYear of [false, true]) {
    it(`no retired price or plan word (6-month ready: ${halfYear})`, () => {
      // Production since 21 Oct: v2 and the reverse trial (the card-trial and
      // card-referral sentences with their 19 EUR plan are flag-off text).
      v2();
      vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
      for (const lang of ["de", "en"] as const) {
        const text = faqSchemaEntries(lang, { halfYear }).map(({ q, a }) => `${q}\n${a}`).join("\n");
        expect(retiredPriceHits(withoutHistory(text)), lang).toEqual([]);
        expect(text).not.toMatch(EM);
        if (!halfYear) expect(text).not.toMatch(/6-Monats-Tarif|6-month plan/);
      }
    });
  }
  it("PUYP copy keeps Sie and no dashes in the v2 overrides", () => {
    v2();
    for (const key of Object.keys(PUYP_COPY) as Array<keyof typeof PUYP_COPY>) {
      expect(tp(key, "de"), key).not.toMatch(DU);
      expect(`${tp(key, "de")} ${tp(key, "en")}`, key).not.toMatch(EM);
    }
  });
});
