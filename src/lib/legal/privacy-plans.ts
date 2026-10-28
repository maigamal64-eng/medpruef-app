/**
 * a-legal-lektor-1027: the /privacy line 3.1 that names the paid plans.
 *
 * It used to say "Pro- und Group-Tarife"; there is no Group plan. With
 * pricing v2 on, the names come from the price owner (V2_PLAN_NAMES via
 * planName), in /pricing order; the 6-month plan is named only while it is
 * on sale (same rule as /terms section 5), the 3-day card trial only while
 * its build copy is on (cardTrialCopyEnabled). "Pro-Test" is the trial name
 * Lektor approved on 24 Oct (cardTrialCopy in billing-copy, /terms 5). Plans bought earlier keep
 * renewing for existing members, so the line covers them too.
 *
 * Pure, client-safe: callers pass the flags.
 */
import type { BillingLang } from "@/lib/billing-copy";
import { V2_PLAN_ORDER } from "@/lib/pricing-v2/offer";
import { planName } from "@/lib/pricing-v2/price-facts";

export interface PrivacyPlanFlags {
  v2: boolean;
  halfYear: boolean;
  cardTrial: boolean;
}

export function privacyPaidPlansLine(lang: BillingLang, flags: PrivacyPlanFlags): string {
  const de = lang === "de";
  // v2 off: the old ladder. The 3-day card trial runs only on the v2 Whop
  // plan, so it is not named here.
  if (!flags.v2) {
    return de
      ? "Abwicklung kostenpflichtiger Pro-Tarife einschließlich Rechnungsstellung."
      : "Processing of paid Pro plans including invoicing.";
  }
  const names = V2_PLAN_ORDER.filter((tier) => tier !== "half_year" || flags.halfYear)
    .map((tier) => planName(tier, lang))
    .join(", ");
  const trial = flags.cardTrial
    ? de ? " und des Pro-Tests mit hinterlegter Karte" : " and the Pro trial with a card on file"
    : "";
  return de
    ? `Abwicklung kostenpflichtiger Tarife (${names} sowie früher gebuchter Tarife)${trial} einschließlich Rechnungsstellung.`
    : `Processing of paid plans (${names}, and plans bought earlier)${trial}, including invoicing.`;
}
