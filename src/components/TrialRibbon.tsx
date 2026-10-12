"use client";
import { billingTrialRibbonLine } from "@/lib/billing-copy";

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

import { authFetch } from "@/lib/authFetch";
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

export default function TrialRibbon({ lang, initiallyEnabled = false }: { lang: "de" | "en"; initiallyEnabled?: boolean }) {
  const [terms, setTerms] = useState<{ trial_days: number; price_after_cents: number } | null>(null);
  const [show, setShow] = useState(initiallyEnabled);
  const ref = useRef<HTMLDivElement | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) { setShow(false); return; }
    } catch {
      /* storage blocked, still allow the ribbon */
    }
    const controller = new AbortController();
    let cancelled = false;
    authFetch("/api/trial/status", { signal: controller.signal, timeoutMs: 8_000, skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean; trial_days?: number; price_after_cents?: number } | null) => {
        if (cancelled || closed.current) return;
        if (d?.enabled && typeof d.trial_days === "number" && typeof d.price_after_cents === "number") { setTerms({ trial_days: d.trial_days, price_after_cents: d.price_after_cents }); setShow(true); } else setShow(false);
      })
      .catch(() => { if (!cancelled && !closed.current) setShow(false); });
    return () => { cancelled = true; controller.abort(); };
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
    closed.current = true;
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
      className="hidden md:block min-h-16 fixed top-0 left-0 right-0 z-[60] bg-[var(--mp-viridian)] text-white"
    >
      <div className="max-w-6xl min-h-16 mx-auto flex items-center gap-3 px-4 py-2 text-sm">
        <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 leading-snug">
          {terms ? billingTrialRibbonLine(lang, { trialDays: terms.trial_days, priceAfterCents: terms.price_after_cents }) : <span aria-label={lang === 'de' ? 'Lädt' : 'Loading'} className="block h-5 max-w-md rounded bg-white/15 animate-pulse" />}
        </p>
        <Link
          href="/pricing?intent=trial#pro-test"
          className="flex-shrink-0 rounded-lg bg-white/15 hover:bg-white/25 px-3 py-1.5 min-h-11 font-semibold transition whitespace-nowrap"
        >
          {de ? "Details" : "Details"}
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label={de ? "Schließen" : "Dismiss"}
          className="flex-shrink-0 min-h-11 min-w-11 p-1 text-white/70 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
