"use client";

/**
 * TrialActivation — the Telegram-gated free Pro trial entry (Notes feature P5).
 *
 * Self-contained: fetches GET /api/trial/activate for eligibility and renders
 * nothing unless the caller is signed in, free, and has never trialed. The
 * activation flow is progressive — tapping "start" calls POST; if Telegram
 * isn't linked yet the card switches to the link step (deep-link to the bot),
 * then the user retries. On success it reloads so the new Pro tier takes effect
 * across the app.
 */

import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { Sparkles, Loader2, Check, Send, RotateCcw } from "lucide-react";

type Lang = "de" | "en";

interface TrialState {
  eligible: boolean;
  is_pro: boolean;
  telegram_linked: boolean;
  already_trialed: boolean;
  trial_expires_at: string | null;
  telegram_deep_link: string | null;
  trial_days: number;
}

type Phase = "idle" | "working" | "needs_telegram" | "done" | "error";

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
  const [deepLink, setDeepLink] = useState<string | null>(null);

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
        if (d) {
          setState(d);
          setDeepLink(d.telegram_deep_link);
          if (!d.telegram_linked) setPhase("needs_telegram");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const activate = async () => {
    setPhase("working");
    try {
      const res = await fetch("/api/trial/activate", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setPhase("done");
        return;
      }
      if (d?.code === "TELEGRAM_REQUIRED") {
        if (d.telegram_deep_link) setDeepLink(d.telegram_deep_link);
        setPhase("needs_telegram");
      } else if (d?.code === "ALREADY_TRIALED" || d?.code === "ALREADY_PRO") {
        setState((s) => (s ? { ...s, eligible: false } : s));
        setPhase("idle");
      } else {
        setPhase("error");
      }
    } catch {
      setPhase("error");
    }
  };

  // Render nothing unless there's a trial to offer.
  if (!signedIn || loading || !state) return null;
  if (state.is_pro) return null;
  if (state.already_trialed && phase !== "done") return null;

  const de = lang === "de";
  const wrap =
    "rounded-[var(--mp-r-card)] border p-4 sm:p-5 " +
    (phase === "done"
      ? "border-[var(--mp-viridian)]/40 bg-[var(--mp-viridian)]/8"
      : "border-[var(--mp-viridian)]/30 bg-gradient-to-br from-[var(--mp-viridian)]/10 to-[var(--mp-accent-teal)]/5") +
    " " +
    className;

  if (phase === "done") {
    return (
      <div className={wrap} role="status">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0">
            <Check className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold text-[var(--mp-fg)]">
              {de
                ? `Deine Gratis-Pro-Woche läuft!`
                : `Your free week of Pro is live!`}
            </p>
            <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
              {de
                ? "Alle Pro-Funktionen sind für 7 Tage freigeschaltet."
                : "Every Pro feature is unlocked for 7 days."}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mp-btn mp-btn--primary mp-btn--sm mt-3"
            >
              {de ? "Loslegen" : "Get started"}
            </button>
          </div>
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
            {phase === "needs_telegram"
              ? de
                ? "Verknüpfe dein Telegram, um die Gratis-Woche zu starten (so erreichen dich auch unsere Erinnerungen)."
                : "Link your Telegram to start the free week (it's also how our reminders reach you)."
              : de
                ? "Unbegrenzte Notizen, KI-Erklärungen und mehr — kein Zahlungsmittel nötig."
                : "Unlimited notes, AI explanations and more — no payment method needed."}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {phase === "needs_telegram" ? (
              <>
                {deepLink && (
                  <a
                    href={deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mp-btn mp-btn--primary mp-btn--sm inline-flex items-center gap-1.5"
                  >
                    <Send className="w-4 h-4" />
                    {de ? "Telegram verknüpfen" : "Link Telegram"}
                  </a>
                )}
                <button
                  type="button"
                  onClick={activate}
                  className="mp-btn mp-btn--ghost mp-btn--sm inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" />
                  {de ? "Verknüpft? Erneut versuchen" : "Linked? Try again"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={activate}
                disabled={phase === "working"}
                className="mp-btn mp-btn--primary mp-btn--sm inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {phase === "working" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {de ? "Gratis-Woche starten" : "Start free week"}
              </button>
            )}
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
