"use client";

/**
 * TrialRibbon — the anonymous top-of-funnel Pro-trial announcement (2026-07-01).
 *
 * A slim, dismissible bar at the very top of the landing page for logged-out
 * visitors (the "unsubscribed users" surface [name] asked for). Self-gating: it
 * fetches the PUBLIC /api/trial/status and renders nothing unless the trial is
 * on, so flipping NOTES_TRIAL_ENABLED off makes it vanish (no stale promo).
 * Honest by rule: the card + the €19/month auto-charge + cancel-anytime are
 * stated up front. CTA routes to sign-in/up, where the in-app trial banner
 * (Library / pricing) starts the actual Whop checkout.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

const DISMISS_KEY = "mp_trial_ribbon_dismissed_v1";

export default function TrialRibbon({ lang }: { lang: "de" | "en" }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* storage blocked — still allow the ribbon */
    }
    fetch("/api/trial/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean } | null) => {
        if (d?.enabled) setShow(true);
      })
      .catch(() => {});
  }, []);

  if (!show) return null;

  const de = lang === "de";
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="relative z-30 bg-[var(--mp-viridian)] text-white">
      <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-2 text-sm">
        <Sparkles className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="font-semibold">
            {de ? "7 Tage MedPrüf Pro gratis." : "7 days of MedPrüf Pro free."}
          </span>{" "}
          <span className="text-white/85">
            {de
              ? "Karte hinterlegen, heute 0 €. Danach 19 €/Monat, jederzeit in der Testphase kündbar."
              : "Add a card, €0 today. Then €19/month, cancel anytime during the trial."}
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
