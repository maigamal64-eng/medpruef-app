/**
 * The v2 landing price preview (a-pricing-v2; moved here in a-pricing-v2-fit
 * so it renders from the one price source, price-facts.ts). Free, the
 * Sitting Pass, 6 months and the Guarantee Ticket; the monthly plan is named
 * in the subtitle. No plan is marked: /pricing marks the fitting one after
 * "When is your exam?". The returning-payer plans never appear here (public
 * surface, decision returning-payer-price). Built per call so a price change
 * in TIERS moves it with every other surface.
 *
 * a-v2-readiness-surfaces-1020: a plan checkout would refuse (PLAN_NOT_READY,
 * v2PlanReady) gets no card, and the subtitle drops the Ticket clause while the
 * Ticket is not sold. `ready` is computed on the server (the readiness flags
 * are server-only env; a client component cannot read them) and passed down.
 */
import { planName, planPrice } from "./price-facts";
import type { V2Readiness } from "./readiness";

// Fail closed and the same on server and client when the prop is absent.
const CLOSED: V2Readiness = { flex_month: true, sitting_pass: true, half_year: false, guarantee_ticket: false };

export function v2LandingPreview(ready: V2Readiness = CLOSED) {
  const ticket = ready.guarantee_ticket;
  return {
    // copy-audit F20 (Lektor, 15 Oct), byte-exact: "free" only with the sample.
    title: {
      de: "Mit der kostenlosen Probe starten. Pro freischalten, wenn Sie bereit sind.",
      en: "Start with the free sample. Unlock Pro when you are ready.",
    },
    subtitle: {
      de: `Jeder bezahlte Tarif enthält alle drei Fragenbanken. Das ${planName("flex_month", "de")} kostet ${planPrice("flex_month", "de")}${ticket ? `; kostenlose Verlängerungsjahre auf Nachweis gibt es mit dem ${planName("guarantee_ticket", "de")}.` : "."}`,
      en: `Every paid plan unlocks all three question banks. The monthly plan costs ${planPrice("flex_month", "en")}${ticket ? `; free renewal years on proof come with the ${planName("guarantee_ticket", "en")}.` : "."}`,
    },
    tiers: [
      {
        name: { de: planName("sitting_pass", "de"), en: planName("sitting_pass", "en") },
        price: planPrice("sitting_pass", "de"),
        period: { de: "bis zu Ihrem Termin", en: "until your exam" },
        pitch: { de: "Einmalzahlung · Zugang bis zum Tag nach Ihrem Termin · höchstens 3 Monate", en: "One payment · access until the day after your sitting · at most 3 months" },
        cta: { de: "Prüfungspass ansehen", en: "See the Sitting Pass" },
        href: "/pricing#exam-timing",
      },
      ...(!ready.half_year ? [] : [{
        name: { de: planName("half_year", "de"), en: planName("half_year", "en") },
        price: planPrice("half_year", "de"),
        period: { de: "180 Tage", en: "180 days" },
        pitch: { de: "Verlängert sich alle 180 Tage, nach Ihrem Prüfungstermin nicht mehr", en: "Renews every 180 days, stops renewing after your exam date" },
        cta: { de: "6 Monate ansehen", en: "See 6 months" },
        href: "/pricing#exam-timing",
      }]),
      ...(!ticket ? [] : [{
        name: { de: planName("guarantee_ticket", "de"), en: planName("guarantee_ticket", "en") },
        price: planPrice("guarantee_ticket", "de"),
        period: { de: "12 Monate", en: "12 months" },
        pitch: { de: "Einmalzahlung · bis zu zwei kostenlose Verlängerungsjahre auf Nachweis", en: "One payment · up to two free renewal years on proof" },
        cta: { de: "Garantie-Ticket ansehen", en: "See the Guarantee Ticket" },
        href: "/pricing#exam-timing",
      }]),
    ],
  };
}
