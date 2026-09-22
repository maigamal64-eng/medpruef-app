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
type Rdt = (...args: unknown[]) => void;

/**
 * Fire the funnel-intent (Lead) conversion on every CTA click that
 * precedes a real SignUp — used by the high-intent landing pages so
 * the ad-platform optimizers (Reddit + Google Ads) see the click signal
 * even when the visitor bounces before completing registration.
 *
 * - Meta: `fbq('track', 'Lead')` — standard Leads objective.
 * - GA4:  `gtag('event', 'generate_lead')` — key event importable into
 *        Google Ads as a conversion.
 * - Reddit: `rdt('track', 'Lead')` — Reddit Ads Lead event.
 *
 * Self-gates on consent + tracker presence exactly like the other
 * helpers, so a single call is safe from any component.
 */
export function trackFunnelIntent(source: string): void {
  if (typeof window === "undefined") return;
  if (getCookieConsent() !== "accepted") return;

  try {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    if (typeof fbq === "function") {
      fbq("track", "Lead", { content_name: source });
    }
  } catch {
    /* analytics must never break the CTA flow */
  }

  try {
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag === "function") {
      gtag("event", "generate_lead", { source });
    }
  } catch {
    /* analytics must never break the CTA flow */
  }

  try {
    const rdt = (window as unknown as { rdt?: Rdt }).rdt;
    if (typeof rdt === "function") {
      rdt("track", "Lead", { source });
    }
  } catch {
    /* analytics must never break the CTA flow */
  }
}

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
export function trackRegistration(conversionId?: string): void {
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

  // Reddit Ads (2026-07-01 pivot): SignUp is Reddit's registration
  // optimization event. Self-gates via rdt presence (loaded only post-consent).
  try {
    const rdt = (window as unknown as { rdt?: Rdt }).rdt;
    if (typeof rdt === "function") {
      // conversionId (the user id) dedupes this against the server-side CAPI
      // SignUp for the same registration (src/lib/reddit-capi.ts).
      rdt("track", "SignUp", conversionId ? { conversionId } : undefined);
    }
  } catch {
    /* analytics must never break the signup flow */
  }
}

/**
 * Fire the Purchase conversion on BOTH ad platforms at the checkout-success
 * moment. Completes the conversion-tracking loop for paid ads (the signup
 * event marks the lead; this marks the sale).
 *
 * - Meta: `fbq('track', 'Purchase', { value, currency })` — Meta's optimization
 *   event for the Sales / value-based objective.
 * - GA4:  `gtag('event', 'purchase', { value, currency, items })` — GA4 key
 *   event imported into Google Ads as a value-tracked conversion.
 *
 * Self-gates on consent + tracker presence exactly like `trackRegistration`,
 * so it only fires after cookie-accept (when the trackers are loaded). Pass
 * `valueEur` in euros (whole or fractional) and the tier id as `tier`.
 */
export function trackPurchase({
  tier,
  valueEur,
  conversionId,
}: {
  tier: string;
  valueEur: number;
  /** Shared id for pixel <-> Conversions-API dedup (e.g. the Whop payment id). */
  conversionId?: string;
}): void {
  if (typeof window === "undefined") return;
  if (getCookieConsent() !== "accepted") return;

  try {
    const fbq = (window as unknown as { fbq?: Fbq }).fbq;
    if (typeof fbq === "function") {
      fbq("track", "Purchase", { value: valueEur, currency: "EUR" });
    }
  } catch {
    /* analytics must never break the post-purchase flow */
  }

  try {
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag === "function") {
      gtag("event", "purchase", {
        value: valueEur,
        currency: "EUR",
        items: [{ item_id: tier }],
      });
    }
  } catch {
    /* analytics must never break the post-purchase flow */
  }

  // Reddit Ads (2026-07-01 pivot): Purchase is Reddit's value/sale event.
  // conversionId (when passed) dedupes this pixel hit against the server-side
  // Conversions-API event for the same transaction (src/lib/reddit-capi.ts).
  try {
    const rdt = (window as unknown as { rdt?: Rdt }).rdt;
    if (typeof rdt === "function") {
      rdt("track", "Purchase", {
        currency: "EUR",
        value: valueEur,
        ...(conversionId ? { conversionId } : {}),
      });
    }
  } catch {
    /* analytics must never break the post-purchase flow */
  }
}
