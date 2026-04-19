"use client";

import { useState, useEffect } from "react";
import { t } from "@/lib/i18n";
import { Cookie } from "lucide-react";

type Lang = "de" | "en";

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

  return (
    <div className="fixed bottom-20 md:bottom-4 left-4 right-4 z-40 flex justify-center animate-slide-reveal">
      <div className="card w-full max-w-lg p-4 rounded-2xl shadow-xl border border-[var(--mp-border)] flex items-center gap-4">
        <Cookie className="w-6 h-6 text-[var(--mp-status-warning)] flex-shrink-0" />
        <p className="text-sm text-[var(--mp-fg-muted)] flex-1">
          {t("cookie_banner", lang)}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
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
