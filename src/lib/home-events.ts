/**
 * Home measurement (UX-HOME-53). One event, `home_cta`, with an enumerated
 * slot; no personal data, no URLs. Goes through the signed tracker, which
 * applies the consent gate and the analytics allowlist (analytics-events.ts).
 */
import { trackEvent } from "@/lib/tracker";

export const HOME_CTA_SLOTS = [
  "hero_study", "hero_plan", "resume", "coach", "topic", "plan", "sip_tile", "other_modes", "mistakes", "saved",
  "due_review", "stat_today", "stat_accuracy", "nav_slot",
] as const;
export type HomeCtaSlot = (typeof HOME_CTA_SLOTS)[number];

export function trackHomeCta(slot: HomeCtaSlot, extra: { exam?: string; kind?: string } = {}): void {
  if (!(HOME_CTA_SLOTS as readonly string[]).includes(slot)) return;
  trackEvent("home_cta", { slot, ...extra });
}
