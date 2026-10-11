import type { MentorPackageOffer, MentorUsageResponse } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { formatDate, formatEur } from "./view-model";
import { shellT } from "./r1-shell-copy";

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
  const subscriber = !!u.source_package || u.subscriptions.length > 0;
  // The trial proposal is an open choice. Its branch receives only generic copy.
  const parts = [pro && u.current_grant ? shellT("pro_exhausted", lang, { n: u.current_grant }) : shellT("exhausted", lang)];
  if (date) parts.push(shellT("renewal", lang, { date }));
  const topup = u.can_buy ? offers.find((p) => p.package_id === "mentor_topup") : undefined;
  const plus = u.can_buy ? offers.find((p) => p.package_id === "mentor_plus") : undefined;
  if ((subscriber || pro) && topup) parts.push(shellT("topup", lang, { n: topup.credits, price: formatEur(topup.price_eur_cents, lang) }));
  else if (pro && plus) parts.push(shellT("more", lang, { name: "Mentor Plus", price: formatEur(plus.price_eur_cents, lang) }));
  const selected = topup && (subscriber || pro) ? "mentor_topup" : "mentor_plus";
  return { reason: parts.join(" "), href: `/mentor/packages?from=exhausted&select=${selected}#topup` };
}
