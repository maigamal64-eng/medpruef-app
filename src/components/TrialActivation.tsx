"use client";

/**
 * TrialActivation — the FREE, NO-CARD 7-day Pro trial entry (2026-07-04).
 *
 * Reverted from the Whop card-on-file trial (which asked a scared candidate to
 * link a card + commit to E19/mo auto-renew for a "free" trial and lost the only
 * organic buyer, Sam). Now one tap, no card, no Telegram required: POSTs
 * /api/trial/activate which grants 7 days of full Pro directly, then the page
 * refreshes into Pro. Paid upgrades still go through the Whop card checkout on
 * /pricing. Self-gating: renders nothing unless signed in, free, and not already
 * trialed. Gated by NOTES_TRIAL_ENABLED (GET returns eligible:false while off).
 */

import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { Sparkles, Loader2, Gift, CheckCircle2 } from "lucide-react";

type Lang = "de" | "en";

interface TrialState {
  eligible: boolean;
  trial_enabled: boolean;
  is_pro: boolean;
  already_trialed: boolean;
  trial_days: number;
}

type Phase = "idle" | "working" | "done" | "error";

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
    fetch("/api/trial/activate")
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
      const res = await fetch("/api/trial/activate", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) {
        setPhase("done");
        // Reflect the new Pro tier everywhere (sidebar, gates, quiz).
        setTimeout(() => window.location.reload(), 1400);
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
  if (!state.eligible && phase !== "done") return null;

  const de = lang === "de";
  const wrap =
    "rounded-[var(--mp-r-card)] border p-4 sm:p-5 border-[var(--mp-viridian)]/30 " +
    "bg-gradient-to-br from-[var(--mp-viridian)]/10 to-[var(--mp-accent-teal)]/5 " +
    className;

  if (phase === "done") {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </span>
          <p className="font-display font-bold text-[var(--mp-fg)]">
            {de
              ? `Pro ist aktiv. ${state.trial_days} Tage voller Zugang, viel Erfolg beim Lernen.`
              : `Pro is active. ${state.trial_days} days of full access, happy studying.`}
          </p>
        </div>
      </div>
    );
  }

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
              ? "Unbegrenzte Fragen, KI-Erklärungen, Notizen und mehr. Keine Karte nötig, kein Abo, es endet einfach von selbst."
              : "Unlimited questions, AI explanations, notes and more. No card needed, no subscription, it simply ends on its own."}
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
                <Gift className="w-4 h-4" />
              )}
              {phase === "working"
                ? de
                  ? "Wird aktiviert …"
                  : "Activating …"
                : de
                  ? "Gratis-Woche starten"
                  : "Start free week"}
            </button>
            <span className="text-xs text-[var(--mp-fg-light)]">
              {de ? "Ein Klick, sofort aktiv" : "One tap, active instantly"}
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
