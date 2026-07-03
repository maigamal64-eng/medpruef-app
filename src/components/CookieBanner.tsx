"use client";

import { useState, useEffect } from "react";
import { t, type Lang } from "@/lib/i18n";
import { Cookie } from "lucide-react";

const COOKIE_KEY = "medpruef_cookies";

export function getCookieConsent(): "accepted" | "declined" | null {
  if (typeof window === "undefined") return null;
  const val = localStorage.getItem(COOKIE_KEY);
  if (val === "accepted" || val === "declined") return val;
  return null;
}

interface CookieBannerProps {
  lang: Lang;
}

export default function CookieBanner({ lang }: CookieBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!getCookieConsent()) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_KEY, "accepted");
    // Tell any listening component (ConsentGatedAnalytics) that the
    // user just granted consent — so GA4 and Clarity can lazy-load
    // without a full page reload.
    try {
      window.dispatchEvent(new CustomEvent("medpruef-consent", { detail: "accepted" }));
    } catch {
      /* non-critical */
    }
    setVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(COOKIE_KEY, "declined");
    try {
      window.dispatchEvent(new CustomEvent("medpruef-consent", { detail: "declined" }));
    } catch {
      /* non-critical */
    }
    setVisible(false);
  };

  if (!visible) return null;

  // Placement (Post-soft-launch §1.4.6.2 fix — occlusion audit 2026-04-23):
  //
  // The previous full-width bottom sheet at z-40 covered the hero primary
  // CTA on / and /pricing at iPhone SE 375×667 — a hard conversion blocker
  // on first visit. We can't suppress the banner (ePrivacy/TTDSG requires
  // the consent record), so instead we:
  //   1. On mobile (<md): shrink to a compact bottom-right pill that
  //      reserves a ~320px-max footprint. Hero CTA remains fully clickable
  //      above the fold.
  //   2. On desktop (md+): keep the centered ~max-w-lg sheet (never had
  //      the occlusion issue at desktop widths).
  //   3. Lower z-index from z-40 → z-30 so hero CTAs with explicit higher
  //      stacking (z-40+) can sit above the banner. Hero CTAs DON'T need
  //      an explicit z-index to stay clickable — the pill is off to the
  //      side — but the lowered z is defence-in-depth.
  //
  // The bottom inset uses env(safe-area-inset-bottom) so the banner
  // doesn't collide with the iPhone home indicator or the mobile
  // BottomNav (h-16) on authenticated routes.
  return (
    <div
      className="mp-cookie-banner fixed right-4 z-30 animate-slide-reveal md:left-4 md:right-4 md:flex md:justify-center"
    >
      <div className="card w-full max-w-[320px] md:max-w-lg p-3 md:p-4 rounded-2xl shadow-xl border border-[var(--mp-border)] flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
        <div className="flex items-start gap-3 md:flex-1">
          <Cookie className="w-5 h-5 md:w-6 md:h-6 text-[var(--mp-status-warning)] flex-shrink-0 mt-0.5 md:mt-0" />
          <p className="text-xs md:text-sm text-[var(--mp-fg-muted)] flex-1 leading-snug">
            {t("cookie_banner", lang)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-auto">
          <button onClick={handleDecline} className="btn-secondary text-xs px-3 py-1.5 rounded-lg">
            {t("cookie_decline", lang)}
          </button>
          <button onClick={handleAccept} className="btn-primary text-xs px-3 py-1.5 rounded-lg">
            {t("cookie_accept", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
