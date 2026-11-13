"use client";
/** KP-DE events (spec 7). Keys only, never typed text or identity. Anonymous ones use the funnel endpoint, signed ones the tracker. */
import { trackFunnelEvent } from "@/lib/funnel-events";
import { trackEvent } from "@/lib/tracker";
import { criticalBucket } from "./case-run";
import { DE_KP_EXAM_KEY } from "./index";

export const DE_KP_SURFACE = "de_kp_landing";

export function trackLandingView(lang: string, utmSource: string | null, utmCampaign: string | null): void {
  trackFunnelEvent("de_kp_landing_view", { lang, ...(utmSource ? { utm_source: utmSource } : {}), ...(utmCampaign ? { utm_campaign: utmCampaign } : {}) }, { once: true });
}
export function trackCta(slot: string, intent: "free_case" | "signup" | "plans"): void {
  trackFunnelEvent("cta_click", { surface: DE_KP_SURFACE, slot, intent });
}
export function trackCaseStart(slug: string, free: boolean, source: string | null): void {
  trackEvent("de_kp_case_start", { case: slug, free, ...(source ? { source } : {}) });
}
export function trackStepDone(slug: string, step: "anamnese" | "differentials" | "bericht" | "oral"): void {
  trackEvent("de_kp_case_step_done", { case: slug, step });
}
export function trackCaseComplete(slug: string, free: boolean, critical: number): void {
  trackEvent("de_kp_case_complete", { case: slug, free, critical_missed: criticalBucket(critical) });
}
export function trackPaywall(surface: string): void {
  trackEvent("paywall_hit", { gate: "de_kp_case", exam: DE_KP_EXAM_KEY, surface });
}
export function trackCheckoutStarted(tier: string): void {
  trackEvent("checkout_started", { source: "de_kp", tier });
}
