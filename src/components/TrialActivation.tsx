"use client";

/**
 * TrialActivation — the Whop card-on-file Pro trial entry (Notes feature P5,
 * 2026-07-01 pivot from the free Telegram-gated trial).
 *
 * Self-contained: fetches GET /api/whop/trial for eligibility and renders
 * nothing unless the caller is signed in, free, and hasn't trialed. Tapping
 * "start" POSTs to create a Whop checkout session and redirects to the hosted
 * purchase page, where the user links a card (€0 today) and starts 7 days of
 * full Pro; Whop auto-charges €19/month afterwards unless they cancel in-trial.
 * On return, /checkout/success grants access (via /api/whop/trial/verify).
 *
 * Honest by rule: the card + the €19/month auto-charge are stated up front (no
 * dark-pattern surprise renewal). Gated OFF until NOTES_TRIAL_ENABLED — GET
 * returns eligible:false while the flag is off, so the banner stays hidden.
 */

import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { Sparkles, Loader2, CreditCard } from "lucide-react";

type Lang = "de" | "en";

interface TrialState {
  eligible: boolean;
  trial_enabled: boolean;
  is_pro: boolean;
  already_trialed: boolean;
  trial_days: number;
  price_after_cents: number;
  currency: string;
}

type Phase = "idle" | "working" | "error";

export default function TrialActivation({
  lang,
  className = "",
}: {
  lang: Lang;
  className?: string;
}) {
  const [state, setState] = useState<TrialState | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    const session = getStoredSession();
    if (!session) {
      setSignedIn(false);
      setLoading(false);
      return;
    }
    fetch("/api/whop/trial")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TrialState | null) => {
        if (d) setState(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const start = async () => {
    setPhase("working");
    try {
      const res = await fetch("/api/whop/trial", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.purchaseUrl) {
        // Redirect to Whop's hosted checkout to link the card.
        window.location.href = d.purchaseUrl;
        return;
      }
      if (d?.code === "ALREADY_TRIALED" || d?.code === "ALREADY_PRO") {
        setState((s) => (s ? { ...s, eligible: false } : s));
        setPhase("idle");
        return;
      }
      setPhase("error");
    } catch {
      setPhase("error");
    }
  };

  if (!signedIn || loading || !state) return null;
  if (!state.eligible) return null;

  const de = lang === "de";
  const price = `${(state.price_after_cents / 100).toFixed(0)} €`;
  const wrap =
    "rounded-[var(--mp-r-card)] border p-4 sm:p-5 border-[var(--mp-viridian)]/30 " +
    "bg-gradient-to-br from-[var(--mp-viridian)]/10 to-[var(--mp-accent-teal)]/5 " +
    className;

  return (
    <div className={wrap}>
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0">
          <Sparkles className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold text-[var(--mp-fg)]">
            {de
              ? `Gratis: ${state.trial_days} Tage MedPrüf Pro`
              : `Free: ${state.trial_days} days of MedPrüf Pro`}
          </p>
          <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
            {de
              ? `Unbegrenzte Notizen, KI-Erklärungen und mehr. Karte hinterlegen, heute 0 €. Danach ${price}/Monat, jederzeit in der Testphase kündbar.`
              : `Unlimited notes, AI explanations and more. Add a card, €0 today. Then ${price}/month, cancel anytime during the trial.`}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              onClick={start}
              disabled={phase === "working"}
              className="mp-btn mp-btn--primary mp-btn--sm inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {phase === "working" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              {phase === "working"
                ? de
                  ? "Weiter zu Whop …"
                  : "Redirecting …"
                : de
                  ? "Gratis-Woche starten"
                  : "Start free week"}
            </button>
            <span className="text-xs text-[var(--mp-fg-light)]">
              {de ? "Sichere Zahlung über Whop" : "Secure payment via Whop"}
            </span>
          </div>

          {phase === "error" && (
            <p className="text-xs text-[var(--mp-error)] mt-2">
              {de
                ? "Etwas ist schiefgelaufen. Bitte versuche es erneut."
                : "Something went wrong. Please try again."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
