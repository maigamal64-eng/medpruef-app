/**
 * Client-side conversion-event helpers for the paid-ads learning test
 * (marketing/campaigns/paid-ads-setup-2026-06-24.md, Step 0).
 *
 * These fire the ad-platform conversion signals at the FREE-REGISTRATION
 * success point. They are deliberately defensive:
 *
 *   1. **Consent-gated** — nothing fires unless the user accepted cookies
 *      (`getCookieConsent() === "accepted"`), the same gate GA4 / Clarity /
 *      the Meta Pixel load behind. No tracker call pre-consent, ever.
 *   2. **typeof-guarded** — `fbq` / `gtag` only exist after their loaders
 *      ran (which themselves only run post-consent). If a tracker isn't
 *      present (env var empty, consent declined, script still loading) the
 *      call is a silent no-op, zero console errors.
 *
 * The consent-gated Pixel/GA events UNDER-count by design. The honest CPL
 * denominator is the consent-independent server row written on every
 * signup (`user_activity_log`, event_type "register", action
 * "email_register" — see src/app/api/auth/route.ts). These client events
 * exist for Meta's optimizer + GA4's key-event → Google Ads import.
 */

import { getCookieConsent } from "@/components/CookieBanner";

type Fbq = (...args: unknown[]) => void;
type Gtag = (...args: unknown[]) => void;

/**
 * Fire the free-registration conversion on BOTH ad platforms.
 *
 * - Meta: `fbq('track', 'CompleteRegistration')` — Meta's optimization
 *   event for the Leads / Sales-CompleteRegistration objective.
 * - GA4:  `gtag('event', 'sign_up')` — marked as a key event in GA4 and
 *   imported into Google Ads as a conversion.
 *
 * Safe to call unconditionally at the register-success moment; it
 * self-gates on consent + tracker presence.
 */
export function trackRegistration(): void {
  if (typeof window === "undefined") return;
  if (getCookieConsent() !== "accepted") return;

  try {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    if (typeof fbq === "function") {
      fbq("track", "CompleteRegistration");
    }
  } catch {
    /* analytics must never break the signup flow */
  }

  try {
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag === "function") {
      gtag("event", "sign_up", { method: "email" });
    }
  } catch {
    /* analytics must never break the signup flow */
  }
}
