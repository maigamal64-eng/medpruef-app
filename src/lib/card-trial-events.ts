"use client";
/**
 * a-card-trial-build-1024: impression and tap events of the card-trial CTA,
 * so the trial funnel is measurable (audit a-trial-telegram-audit-1024: the
 * Telegram trial prompt had no event at all). Sent on the anonymous funnel
 * endpoint (landing visitors have no session), keys allowlisted in
 * src/lib/analytics-events.ts. An impression counts once per surface and
 * browser session; every tap counts.
 */
import { trackFunnelEvent } from "@/lib/funnel-events";

export type CardTrialSurface =
  | "landing_hero" | "landing_cta" | "ribbon" | "pricing_visitor" | "pricing_tile" | "library_tile" | "home_card";

const SEEN_PREFIX = "medpruef_card_trial_seen:";

export function trackCardTrialView(surface: CardTrialSurface, tier: string | null = null): void {
  try {
    if (sessionStorage.getItem(SEEN_PREFIX + surface)) return;
    sessionStorage.setItem(SEEN_PREFIX + surface, "1");
  } catch {
    // Measurement must not block the page; without storage it may repeat.
  }
  trackFunnelEvent("card_trial_cta_view", tier ? { surface, tier } : { surface });
}

export function trackCardTrialClick(surface: CardTrialSurface, tier: string | null = null): void {
  trackFunnelEvent("card_trial_cta_click", tier ? { surface, tier } : { surface });
}
