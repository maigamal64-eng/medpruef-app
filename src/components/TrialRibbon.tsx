"use client";

/**
 * TrialRibbon, the anonymous top-of-funnel Pro-trial announcement (2026-07-01).
 *
 * A slim, dismissible bar pinned at the very top of the landing for logged-out
 * visitors. Self-gating: it fetches the PUBLIC /api/trial/status and renders
 * nothing unless the trial is on, so flipping NOTES_TRIAL_ENABLED off makes it
 * vanish (no stale promo). Honest by rule: the card, the 19 EUR/month auto-charge
 * and cancel-anytime are stated up front.
 *
 * FB-01/FB-02 fix (2026-07-01): the bar is `fixed` and publishes its rendered
 * height to the CSS var --mp-ribbon-h on the document root (0 when hidden or
 * dismissed). The landing Nav offsets its `top` off that var so it sits BELOW
 * the ribbon instead of overlapping it, and the page pads its top by the same
 * var, all driven by ONE source of truth.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

const DISMISS_KEY = "mp_trial_ribbon_dismissed_v1";
const RIBBON_H_VAR = "--mp-ribbon-h";

function setRibbonH(px: number) {
  try {
    document.documentElement.style.setProperty(RIBBON_H_VAR, `${px}px`);
  } catch {
    /* no document (SSR) */
  }
}

export default function TrialRibbon({ lang }: { lang: "de" | "en" }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* storage blocked, still allow the ribbon */
    }
    fetch("/api/trial/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean } | null) => {
        if (d?.enabled) setShow(true);
      })
      .catch(() => {});
  }, []);

  // Publish the rendered height so the fixed nav can offset below it and the
  // page can pad for it. Reset to 0 when not shown or on unmount.
  useEffect(() => {
    if (!show) {
      setRibbonH(0);
      return;
    }
    const measure = () => setRibbonH(ref.current?.offsetHeight ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      setRibbonH(0);
    };
  }, [show]);

  if (!show) return null;

  const de = lang === "de";
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setRibbonH(0);
    setShow(false);
  };

  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 right-0 z-[60] bg-[var(--mp-viridian)] text-white"
    >
      <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-2 text-sm">
        <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="font-semibold">
            {de ? "7 Tage MedPrüf Pro gratis." : "7 days of MedPrüf Pro free."}
          </span>{" "}
          <span className="text-white/85">
            {de
              ? "Keine Karte nötig, kein Abo. Voller Zugang, endet einfach von selbst."
              : "No card needed, no subscription. Full access, it simply ends on its own."}
          </span>
        </p>
        <Link
          href="/login"
          className="flex-shrink-0 rounded-lg bg-white/15 hover:bg-white/25 px-3 py-1.5 font-semibold transition whitespace-nowrap"
        >
          {de ? "Gratis-Woche starten" : "Start free week"}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label={de ? "Schließen" : "Dismiss"}
          className="flex-shrink-0 p-1 text-white/70 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
