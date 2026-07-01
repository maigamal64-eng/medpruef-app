"use client";

import { useEffect } from "react";
import { getCookieConsent } from "@/components/CookieBanner";

/**
 * Loads the Reddit Pixel ONLY after the user has explicitly accepted
 * cookies, the exact same consent gate as GA4 + Clarity
 * (`ConsentGatedAnalytics.tsx`) and the Meta Pixel
 * (`ConsentGatedMetaPixel.tsx`) (ePrivacy Directive / Austrian TTDSG).
 *
 * Reddit Ads pivot (2026-07-01): the Reddit Ads campaign (account
 * Desperate-Silver-624) optimizes on this pixel's SignUp + Purchase
 * conversion events. Pixel id lives in NEXT_PUBLIC_REDDIT_PIXEL_ID.
 *
 * Behaviour (identical discipline to the Meta pixel):
 *   - If NEXT_PUBLIC_REDDIT_PIXEL_ID is absent/empty, clean no-op: nothing
 *     injects, `rdt` is never defined, zero console errors.
 *   - On consent === "accepted": injects the standard rdt bootstrap +
 *     `rdt('init', ID)` + `rdt('track', 'PageVisit')`.
 *   - On decline: nothing loads.
 *   - Reacts to the CookieBanner `medpruef-consent` event so a fresh accept
 *     loads the pixel without a reload.
 *
 * The consent-gated pixel UNDER-counts by design (decliners still convert but
 * fire no event). The honest denominator stays the server rows; the Reddit
 * Conversions API (src/lib/reddit-capi.ts, server-side, dormant until the
 * token is set) is the consent-independent + ad-blocker-proof complement,
 * deduped against this pixel on a shared conversion id. The pixel is for
 * Reddit's optimizer + the retargeting pool.
 */

const REDDIT_PIXEL_ID = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID;

function loadRedditPixel() {
  if (!REDDIT_PIXEL_ID) return; // env empty → clean no-op, no rdt defined
  if (typeof window === "undefined") return;
  if (
    (window as unknown as { rdt?: unknown }).rdt ||
    document.getElementById("reddit-pixel-loader")
  ) {
    return;
  }

  // Standard Reddit Pixel bootstrap (the official snippet from
  // ads.reddit.com Events Manager), src threaded through this consent gate
  // instead of a hard-coded <Script> in layout.tsx.
  const s = document.createElement("script");
  s.id = "reddit-pixel-loader";
  s.textContent =
    `!function(w,d){if(!w.rdt){var p=w.rdt=function(){` +
    `p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};` +
    `p.callQueue=[];var t=d.createElement("script");` +
    `t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;` +
    `var s=d.getElementsByTagName("script")[0];` +
    `s.parentNode.insertBefore(t,s)}}(window,document);` +
    `rdt('init','${REDDIT_PIXEL_ID}');` +
    `rdt('track','PageVisit');`;
  document.head.appendChild(s);
}

export default function ConsentGatedRedditPixel() {
  useEffect(() => {
    if (!REDDIT_PIXEL_ID) return; // dormant until the env var is set

    const tryLoad = () => {
      if (getCookieConsent() !== "accepted") return;
      loadRedditPixel();
    };

    tryLoad(); // on mount if already accepted (returning user)

    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "accepted") loadRedditPixel();
    };
    window.addEventListener("medpruef-consent", onConsent);
    return () => {
      window.removeEventListener("medpruef-consent", onConsent);
    };
  }, []);

  return null;
}
