"use client";

import { isAdminPath } from "@/lib/admin-route";
import { useEffect } from "react";
import { getCookieConsent } from "@/components/CookieBanner";

/**
 * Loads the Meta (Facebook) Pixel ONLY after the user has explicitly
 * accepted cookies — the exact same consent gate as GA4 + Clarity in
 * `ConsentGatedAnalytics.tsx` (ePrivacy Directive / Austrian TTDSG).
 *
 * Why a separate component (not folded into ConsentGatedAnalytics):
 * the Pixel is its own tracker with its own env var and its own
 * lifecycle, so it stays isolated and independently no-ops when the
 * paid-ads test is not running.
 *
 * Behaviour:
 *   - If `NEXT_PUBLIC_META_PIXEL_ID` is absent/empty, this is a clean
 *     no-op: nothing injects, `fbq` is never defined, zero console
 *     errors. ([name] fills the env var once the Pixel is created in
 *     Meta Events Manager — see marketing/campaigns/paid-ads-setup-2026-06-24.md
 *     Step 0; until then the whole thing is dormant.)
 *   - On consent === "accepted" it injects the standard fbq bootstrap
 *     + `fbq('init', ID)` + `fbq('track', 'PageView')`.
 *   - On decline, nothing loads.
 *   - Reacts to the CookieBanner's `medpruef-consent` CustomEvent so a
 *     fresh accept loads the Pixel without a page reload (mirrors GA4).
 *
 * The consent-gated Pixel UNDER-counts by design (anyone who declines
 * cookies still signs up but fires no CompleteRegistration). The honest
 * CPL denominator is the server-side `user_activity_log` register row
 * (event_type "register"), NOT this Pixel number. The Pixel exists for
 * Meta's optimizer + the retargeting pool.
 */

const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

function loadMetaPixel() {
  if (typeof window !== "undefined" && isAdminPath(window.location.pathname)) return;
  if (!META_PIXEL_ID) return; // env empty → clean no-op, no fbq defined
  if (typeof window === "undefined") return;
  // Already bootstrapped (fbq present) or script already injected.
  if (
    (window as unknown as { fbq?: unknown }).fbq ||
    document.getElementById("meta-pixel-loader")
  ) {
    return;
  }

  // Standard Meta Pixel bootstrap (the official snippet), with the
  // src moved to an injected <script> tag so it threads through this
  // consent gate instead of a hard-coded <Script> in layout.tsx.
  const s = document.createElement("script");
  s.id = "meta-pixel-loader";
  s.textContent =
    `!function(f,b,e,v,n,t,s)` +
    `{if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};` +
    `if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';` +
    `n.queue=[];t=b.createElement(e);t.async=!0;` +
    `t.src=v;s=b.getElementsByTagName(e)[0];` +
    `s.parentNode.insertBefore(t,s)}(window,document,'script',` +
    `'https://connect.facebook.net/en_US/fbevents.js');` +
    `fbq('init','${META_PIXEL_ID}');` +
    `fbq('track','PageView');`;
  document.head.appendChild(s);
}

export default function ConsentGatedMetaPixel() {
  useEffect(() => {
    if (isAdminPath(window.location.pathname)) return;
    if (!META_PIXEL_ID) return; // dormant until [name] sets the env var

    const tryLoad = () => {
      if (getCookieConsent() !== "accepted") return;
      loadMetaPixel();
    };

    tryLoad(); // on mount if already accepted (returning user)

    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "accepted") loadMetaPixel();
    };
    window.addEventListener("medpruef-consent", onConsent);
    return () => {
      window.removeEventListener("medpruef-consent", onConsent);
    };
  }, []);

  return null;
}
