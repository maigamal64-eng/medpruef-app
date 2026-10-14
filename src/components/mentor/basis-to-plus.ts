/**
 * Basis to Plus (mentor-open-picks 3 A, [name] delegation 14 Oct 2026).
 *
 * There is no in-app plan switch: buying Plus while Basis is active creates a
 * second Whop subscription (the checkout only blocks the same package twice).
 * The Plus card therefore tells an active Basis subscriber how to switch. Whop
 * deactivation leaves granted lots to run to their own expiry; only a refund
 * or chargeback claws credits back (src/lib/mentor/credits/whop-branch.ts).
 * No refund or proration claim. A cancellation scheduled at Whop is not
 * visible here, so the line says "if you have not done so already".
 * Lektor-approved wording 14 Oct (DE, EN); other languages show English.
 */
import type { MentorUiLang } from "@/lib/i18n-mentor";
import type { MentorUsageResponse } from "@/lib/mentor/contract";
import { deOrEn } from "./a39-copy";

const COPY = {
  de: {
    switch: "Wechsel zu Mentor Plus: Buchen Sie Plus und kündigen Sie danach Mentor Basis über „Bei Whop verwalten“ auf der Basis-Karte, falls noch nicht geschehen. Bereits erhaltene Credits bleiben bis zu ihrem Ablauf nutzbar.",
    topup: "Wenn Sie nur mehr Credits brauchen, nutzen Sie stattdessen die einmalige Aufladung.",
  },
  en: {
    switch: "Switching to Mentor Plus: buy Plus, then cancel Mentor Basis with “Manage on Whop” on the Basis card, if you have not done so already. Credits you have already received stay usable until they expire.",
    topup: "If you only need more credits, use the one-time top-up instead.",
  },
} as const;

export function basisToPlusCopy(key: keyof (typeof COPY)["de"], lang: MentorUiLang): string {
  return COPY[deOrEn(lang)][key];
}

/**
 * True when the Plus card should carry the switch line: the learner holds an
 * active Mentor Basis subscription, has no Mentor Plus yet, and could buy Plus
 * now (not resting, buying allowed, no Plus purchase pending). The status
 * checks are defensive: readActiveMentorSubscriptions reports active rows only.
 */
export function showBasisToPlus(usage: MentorUsageResponse | undefined, plusPurchaseDisabled: boolean): boolean {
  if (!usage || plusPurchaseDisabled) return false;
  const subs = Array.isArray(usage.subscriptions) ? usage.subscriptions : [];
  // The line points at the Basis card's "Bei Whop verwalten" link, which renders only with a management URL.
  const basis = subs.some((s) => s.package_id === "mentor_basis" && s.status !== "ending" && s.status !== "payment_failed" && !!s.management_url);
  const plus = subs.some((s) => s.package_id === "mentor_plus");
  return basis && !plus;
}
