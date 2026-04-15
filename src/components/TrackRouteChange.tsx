"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackPageView } from "@/lib/tracker";

/**
 * Fires GA4 `config` + an internal `page_view` tracker event on every
 * App Router client-side navigation.
 *
 * Previously, the `gtag('config', GA_ID, { page_path })` in
 * layout.tsx fired exactly once on initial hydration — Next.js's
 * soft client-side navigation never re-ran it, so GA4's
 * "Pages per session" was ≈ 1 for every user and funnel analysis
 * was impossible (Analytics audit GA4 bug + Infra audit).
 *
 * Similarly, the only place in the app that fired `trackPageView`
 * was /quiz — so the `user_events.page_view` rows only ever came
 * from that one route, and every per-page engagement metric was
 * missing for home/exam/flashcards/progress/curriculum/etc.
 *
 * This component fixes both at once by watching `usePathname()` and
 * firing the right side-effects on every change. It's mounted from
 * layout.tsx inside the consent-gated area — it's safe to fire
 * regardless of consent because trackPageView uses the app's own
 * pipeline (not GA4), and the `gtag` call only fires if
 * `window.gtag` was loaded by ConsentGatedAnalytics (i.e. consent
 * has been given).
 */
export default function TrackRouteChange() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;

    // Fire the app's own page_view tracker event regardless of
    // cookie consent (it goes to our first-party DB, not a third
    // party).
    try {
      trackPageView(pathname);
    } catch {
      /* non-critical */
    }

    // Fire GA4 config only if window.gtag exists (i.e. consent
    // accepted and ConsentGatedAnalytics loaded the snippet).
    try {
      const win = window as unknown as {
        gtag?: (...args: unknown[]) => void;
      };
      if (typeof win.gtag === "function" && process.env.NEXT_PUBLIC_GA_ID) {
        const qs = searchParams?.toString();
        const path = qs ? `${pathname}?${qs}` : pathname;
        win.gtag("config", process.env.NEXT_PUBLIC_GA_ID, { page_path: path });
      }
    } catch {
      /* non-critical */
    }
  }, [pathname, searchParams]);

  return null;
}
