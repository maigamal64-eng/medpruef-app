import type { MentorPackageOffer, MentorUsageResponse } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { formatDate, formatEur } from "./view-model";
import { shellT } from "./r1-shell-copy";
import { admissionGapText } from "./a38-copy";
import { a39T } from "./a39-copy";
import { r3PackageCopy } from "./r3-package-copy";

export const TURN_SILENCE_MS = 45_000;

/** Visual viewport shrink, rather than input focus, determines keyboard state. */
export function keyboardIsOpen(layoutHeight: number, viewportHeight: number): boolean {
  return layoutHeight - viewportHeight > Math.max(100, layoutHeight * 0.15);
}

export function lowCreditText(u: MentorUsageResponse, lang: MentorUiLang): string {
  const date = formatDate(u.renewal_at, lang);
  return shellT(date ? "low" : "low_no_date", lang, { x: Math.max(0, Math.floor(u.credits_left)), date });
}

export function exhaustedState(u: MentorUsageResponse, offers: MentorPackageOffer[], lang: MentorUiLang) {
  const date = formatDate(u.renewal_at, lang);
  const pro = u.sources.includes("pro_included");
  const subscriber = u.subscriptions.length > 0 || (!!u.source_package && !["free_taste", "trial_taste"].includes(u.source_package));
  // MUX-22: the trial (card trial or the one-time free taste) gets its own end
  // line, so the end of a taste never reads as a failure (MUX-20).
  const freeTaste = !pro && !subscriber && !!u.trial?.free_taste;
  const cardTrial = !pro && !subscriber && !freeTaste && (u.source === "trial" || !!u.trial);
  // MUX-23: above zero but under the bar, name the bar instead of "used up".
  const gap = admissionGapText(u.credits_left, u.admit_min_credits, lang);
  const used = freeTaste ? a39T("free_taste_end", lang) : cardTrial ? a39T("trial_used", lang) : pro && u.current_grant ? shellT("pro_exhausted", lang, { n: u.current_grant }) : shellT("exhausted", lang);
  const parts = [gap ?? used];
  if (cardTrial && u.trial?.pro_included_credits !== undefined) parts.push(r3PackageCopy("trialForward", lang, { credits: u.trial.pro_included_credits }));
  if (date) parts.push(shellT("renewal", lang, { date }));
  const topup = u.can_buy ? offers.find((p) => p.package_id === "mentor_topup") : undefined;
  const plus = u.can_buy ? offers.find((p) => p.package_id === "mentor_plus") : undefined;
  if ((subscriber || pro) && topup) parts.push(shellT("topup", lang, { n: topup.credits, price: formatEur(topup.price_eur_cents, lang) }));
  else if (pro && plus) parts.push(shellT("more", lang, { name: "Mentor Plus", price: formatEur(plus.price_eur_cents, lang) }));
  // A trial or free taste at zero starts at the entry package; Pro and subscribers go up (never Pro again).
  const selected = topup && (subscriber || pro) ? "mentor_topup" : subscriber || pro ? "mentor_plus" : "mentor_basis";
  // The composer placeholder is one 44px line on phones: it gets the short form.
  const composerReason = admissionGapText(u.credits_left, u.admit_min_credits, lang, "short") ?? parts.join(" ");
  return { reason: parts.join(" "), composerReason, href: `/mentor/packages?from=exhausted&select=${selected}#topup` };
}
