/**
 * Plans the Germany surface may show (spec 8): the Monatsabo and the 3-day card
 * trial that converts into it. Amounts are read from price-facts at render and
 * never typed into Germany copy. No Prüfungspass, Garantie-Ticket or 6 months.
 */
import { planPrice } from "@/lib/pricing-v2/price-facts";
import { cardTrialCopy } from "@/lib/billing-copy";
import { cardTrialCopyEnabled } from "@/lib/card-trial";
import { fillCopy, type DeKpLang } from "./copy";
import { PLAN_STEP_PATH } from "./login-copy";
import { deKpCopy } from "./copy";

/**
 * The plan step lives on the Germany route (a-dekp-walkfix-1120): /pricing shows
 * the Austrian exam picker and sittings before checkout, so no Germany link goes there.
 */
export { PLAN_STEP_PATH };
export const CASES_PATH = "/kenntnispruefung-deutschland/faelle";

export type DeKpPlanFocus = "month" | "trial";

export function planStepHref(lang: DeKpLang, plan?: DeKpPlanFocus): string {
  const q = new URLSearchParams();
  if (lang === "en") q.set("lang", "en");
  if (plan) q.set("plan", plan);
  const qs = q.toString();
  return qs ? `${PLAN_STEP_PATH}?${qs}` : PLAN_STEP_PATH;
}

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

/** Cases behind Pro: the total minus the one free case (computed, never typed; the free case is open to every account). */
export function paidCaseCount(total: number, freeSlug: string | null): number {
  return Math.max(0, total - (freeSlug ? 1 : 0));
}
