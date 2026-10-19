import { billingAmount } from "@/lib/billing-copy";
import { FREE_TIER, TIERS } from "@/lib/content-truth";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";

/**
 * a-flip-copy-fixes-1018: under the v2 offer the retired Cohort (129 EUR) and
 * the hidden 19 EUR first month are not printed; the safety net is the
 * Guarantee Ticket and the entry is the v2 Monthly plan. Flag off: unchanged.
 */
const LINE: Record<"de" | "en", (ticket: string, monthly: string, n: number) => string> = {
  de: (ticket, monthly, n) => `Das Garantie-Ticket kostet ${ticket} einmalig für 12 Monate. Verlängerungen richten sich nach den veröffentlichten Bedingungen des Garantie-Tickets. Pro gibt es ab ${monthly} alle 30 Tage, und ${n} Fragen pro Prüfung kannst du vorher kostenlos testen, ohne Kreditkarte.`,
  en: (ticket, monthly, n) => `The Guarantee Ticket costs ${ticket} once for 12 months. Extensions follow the published Guarantee Ticket conditions. Pro starts at ${monthly} every 30 days, and you can try ${n} questions per exam at no cost, no credit card.`,
};

export function safetyNetLine(lang: "de" | "en"): string | null {
  if (!pricingV2Enabled()) return null;
  return LINE[lang](
    billingAmount(TIERS.guarantee_ticket.price_cents, lang),
    billingAmount(TIERS.flex_month.price_cents, lang),
    FREE_TIER.questions_per_exam_type,
  );
}
