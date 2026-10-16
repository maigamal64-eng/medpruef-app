/**
 * The per-plan total under "When is your exam?" (a-pricing-v2-fit, decision
 * sitting-fit). One sentence per card, price last, formal Sie, no em
 * dashes, never a break-even. Numbers come from fit.ts.
 */
import type { BillingLang } from "@/lib/billing-copy";
import { billingAmount } from "@/lib/billing-copy";
import type { PlanFit } from "@/lib/pricing-v2/fit";
import { RENEWAL_GUARD_DAYS } from "@/lib/pricing-v2/renewal-guard";
import { longDate } from "./plans";

function chargesDe(n: number): string {
  return n === 1 ? "1 Abbuchung" : `${n} Abbuchungen`;
}
function chargesEn(n: number): string {
  return n === 1 ? "1 charge" : `${n} charges`;
}

/** Lines for one card; empty when the plan does not cover the sitting (the pass explains its own end). */
export function fitLines(fit: PlanFit, lang: BillingLang): string[] {
  const de = lang === "de";
  if (!fit.covers) return [];
  const total = billingAmount(fit.totalCents, lang);
  if (fit.tier === "flex_month") {
    return [de
      ? `Bis zu Ihrem Termin: ${chargesDe(fit.charges)}, zusammen ${total}. Danach läuft das Abo weiter, bis Sie kündigen.`
      : `Up to your sitting: ${chargesEn(fit.charges)}, ${total} in total. After that the plan keeps running until you cancel.`];
  }
  if (fit.tier === "half_year") {
    const lines = [de
      ? `Bis zu Ihrem Termin: ${chargesDe(fit.charges)}, zusammen ${total}.`
      : `Up to your sitting: ${chargesEn(fit.charges)}, ${total} in total.`];
    if (fit.guardedRenewalAt && fit.accessUntil) {
      const renews = longDate(fit.guardedRenewalAt, lang);
      // accessUntil is the first instant after the day after the sitting.
      const until = longDate(new Date(Date.parse(fit.accessUntil) - 1).toISOString(), lang);
      lines.push(de
        ? `Die Verlängerung am ${renews} fiele in die ${RENEWAL_GUARD_DAYS} Tage vor Ihrem Termin. Deshalb entfällt sie, und Ihr Zugang läuft ohne weitere Abbuchung bis einschließlich ${until}.`
        : `The renewal on ${renews} would fall in the ${RENEWAL_GUARD_DAYS} days before your sitting. So it is skipped, and your access runs on without another charge through ${until}.`);
    }
    return lines;
  }
  if (fit.tier === "guarantee_ticket" && fit.needsRenewalYear) {
    return [de
      ? `Ihr Termin liegt nach den 12 Monaten. Mit der Anmeldebestätigung für diesen Termin erhalten Sie ein Verlängerungsjahr ohne Abbuchung. Bis zu Ihrem Termin: einmalig ${total}.`
      : `Your sitting is after the 12 months. With the registration confirmation for that sitting you receive a renewal year without a charge. Up to your sitting: ${total} once.`];
  }
  return [de ? `Bis zu Ihrem Termin: einmalig ${total}.` : `Up to your sitting: ${total} once.`];
}
