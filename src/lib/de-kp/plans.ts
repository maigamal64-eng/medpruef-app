/**
 * Plans the Germany surface may show (spec 8): the Monatsabo and the 3-day card
 * trial that converts into it. Amounts are read from price-facts at render and
 * never typed into Germany copy. No Prüfungspass, Garantie-Ticket or 6 months.
 */
import { planPrice } from "@/lib/pricing-v2/price-facts";
import { cardTrialCopy } from "@/lib/billing-copy";
import { cardTrialCopyEnabled } from "@/lib/card-trial";
import { fillCopy, type DeKpLang } from "./copy";
import { deKpCopy } from "./copy";

export const MONTH_ACTION_HREF = "/pricing?action=flex-month-checkout";
export const TRIAL_ACTION_HREF = "/pricing?action=trial&intent=trial";

export function monthTerms(lang: DeKpLang): string {
  return fillCopy(deKpCopy(lang).landing.monthTerms, { price: planPrice("flex_month", lang) });
}

/** The card-trial terms line (billing-copy owns the wording and amounts); empty while the trial is not on in this build. */
export function trialTerms(lang: DeKpLang): string {
  return cardTrialCopyEnabled() ? cardTrialCopy(lang).terms : "";
}

export function trialButton(lang: DeKpLang): string {
  return cardTrialCopyEnabled() ? cardTrialCopy(lang).button : deKpCopy(lang).landing.trialCta;
}
