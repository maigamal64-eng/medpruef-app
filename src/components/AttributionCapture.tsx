"use client";

import { useEffect } from "react";
import { captureAttributionFromUrl } from "@/lib/attribution";

/**
 * Mounts once in the root layout. On first load with campaign params in the
 * URL (utm_* / rdt_cid), stores them first-touch to localStorage so the
 * register call can attribute the signup. Renders nothing, never blocks.
 *
 * 2026-07-03: also fires the first-party landing-hit beacon
 * (/api/beacon/landing) for /landing arrivals and any UTM-tagged arrival.
 * Anonymous + cookieless (no id, no IP, no raw UA — see the route
 * docstring), so it may fire pre-consent; deduped per browser-session.
 * This is the ground-truth arrival count for paid probes: GA4 is
 * consent-gated and /api/track is login-gated, so without this an ad
 * click that bounces is invisible everywhere.
 */
export default function AttributionCapture() {
  useEffect(() => {
    captureAttributionFromUrl();

    try {
      const p = new URLSearchParams(window.location.search);
      const isLanding = window.location.pathname === "/landing";
      const hasUtm = ["utm_source", "utm_medium", "utm_campaign", "utm_content"].some(
        (k) => p.get(k)
      );
      if (!isLanding && !hasUtm) return;
      const KEY = "medpruef_landing_hit_sent";
      if (window.sessionStorage.getItem(KEY)) return;
      window.sessionStorage.setItem(KEY, "1");
      const payload = JSON.stringify({
        path: window.location.pathname,
        utm_source: p.get("utm_source") || undefined,
        utm_medium: p.get("utm_medium") || undefined,
        utm_campaign: p.get("utm_campaign") || undefined,
        utm_content: p.get("utm_content") || undefined,
        has_click_id: !!p.get("rdt_cid"),
        ref_host: document.referrer ? new URL(document.referrer).hostname : undefined,
        lang: navigator.language || undefined,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/beacon/landing",
          new Blob([payload], { type: "application/json" })
        );
      } else {
        fetch("/api/beacon/landing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      /* counting is best-effort, never break the page */
    }
  }, []);
  return null;
}
