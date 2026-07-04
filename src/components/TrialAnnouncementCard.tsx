"use client";

/**
 * TrialAnnouncementCard — in-app, dismissible Pro-trial announcement for
 * returning FREE users (FB-04, 2026-07-01).
 *
 * Distinct from the other two trial surfaces already shipped:
 *   - <TrialRibbon> — logged-OUT visitors, top of the public /landing page.
 *   - <TrialActivation> — the full activation card on /library and /pricing,
 *     surfaces a user reaches with intent (browsing notes / comparing tiers).
 *
 * This one is the missing piece: a slim, dismissible banner on the
 * HOME DASHBOARD (`/`) so a logged-in FREE user who just re-opens the app
 * (not specifically shopping for Pro) still hears about the trial. Never
 * shown to pro / trial / admin users — an active trial already flips
 * `users.tier` to 'pro' server-side (see api/webhooks/whop), so the tier
 * gate alone excludes them; the /api/whop/trial eligibility check (which
 * separately encodes trial_enabled && !is_pro && !already_trialed) is
 * layered on top as the same "reuse the eligibility API" pattern
 * <TrialActivation> uses, so a stale client-side tier read never shows a
 * trial pitch to someone who already used or is mid-trial.
 *
 * Self-contained: mounts once on the dashboard, fetches its own state,
 * renders nothing until it has a confirmed "yes, show this" signal. Does
 * NOT touch `useAnnouncementGate` or any of its elected surfaces (cohort
 * banner / orientation modal / referral floater) — this is a stationary
 * card like <ReferralCodeCard>, always eligible to render on its own
 * gate, coexisting with whatever the gate elects.
 *
 * Dismiss is per-user + persistent: a localStorage key namespaced by
 * userId (so a second account on the same device isn't silently
 * pre-dismissed) that never re-shows the card once closed. No backend
 * `user_announcements` column needed for a single dismiss-forever
 * boolean — matches the lightweight pattern <TrialRibbon> already uses
 * for the same "dismiss and never bother again" behaviour.
 *
 * Honest copy, no dark patterns (2026-07-04): the trial is now FREE and
 * NO-CARD (one tap, no subscription, ends on its own). Repointed from the
 * Whop card trial to /api/trial/activate, matching <TrialActivation>.
 */

import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Sparkles, X, Gift, Loader2 } from "lucide-react";

type Lang = "de" | "en";

interface TrialEligibility {
  eligible: boolean;
  trial_enabled: boolean;
  is_pro: boolean;
  already_trialed: boolean;
  trial_days: number;
}

type Phase = "idle" | "working" | "done" | "error";

function dismissKey(userId: string): string {
  return `mp_trial_announce_dismissed_v1_${userId}`;
}

export default function TrialAnnouncementCard({
  userId,
  lang,
  className = "",
}: {
  /** Logged-in user's id. Required so the dismiss key is per-account. */
  userId: string;
  lang: Lang;
  className?: string;
}) {
  const [state, setState] = useState<TrialEligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(true); // fail-closed until checked
  const [phase, setPhase] = useState<Phase>("idle");

  // Guests never see this — no persistent trial identity to grant against.
  const isGuest = userId.startsWith("guest_");

  useEffect(() => {
    if (isGuest) {
      setLoading(false);
      return;
    }
    try {
      setDismissed(localStorage.getItem(dismissKey(userId)) === "1");
    } catch {
      // Storage blocked — default to NOT dismissed so the card can still
      // show (matches <TrialRibbon>'s "still allow" fallback); a user
      // without localStorage just can't persist their dismiss choice.
      setDismissed(false);
    }

    fetch("/api/trial/activate", { skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TrialEligibility | null) => {
        if (d) setState(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId, isGuest]);

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(userId), "1");
    } catch {
      /* ignore — non-persistent dismiss for this session's render only */
    }
    setDismissed(true);
  };

  const start = async () => {
    setPhase("working");
    try {
      const res = await fetch("/api/trial/activate", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) {
        setPhase("done");
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

  if (isGuest || loading || dismissed || !state) return null;
  if (!state.eligible && phase !== "done") return null;

  const de = lang === "de";

  return (
    <div
      className={
        "relative flex items-start gap-3 rounded-[var(--mp-r-card)] border p-4 " +
        "border-[var(--mp-viridian)]/30 bg-gradient-to-br from-[var(--mp-viridian)]/10 " +
        "to-[var(--mp-accent-teal)]/5 " +
        className
      }
      role="region"
      aria-label={de ? "Gratis-Testwoche Hinweis" : "Free trial announcement"}
    >
      <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0">
        <Sparkles className="w-5 h-5" />
      </span>

      <div className="min-w-0 flex-1 pr-6">
        <p className="font-display font-bold text-[var(--mp-fg)]">
          {de
            ? `Gratis: ${state.trial_days} Tage MedPrüf Pro`
            : `Free: ${state.trial_days} days of MedPrüf Pro`}
        </p>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
          {de
            ? "Keine Karte nötig, kein Abo. Voller Zugang, endet einfach von selbst."
            : "No card needed, no subscription. Full access, it simply ends on its own."}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            onClick={start}
            disabled={phase === "working" || phase === "done"}
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
              : phase === "done"
                ? de
                  ? "Pro ist aktiv"
                  : "Pro is active"
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

      <button
        type="button"
        onClick={dismiss}
        aria-label={de ? "Schließen" : "Dismiss"}
        className="absolute top-3 right-3 p-1 rounded-lg text-[var(--mp-fg-light)] hover:text-[var(--mp-fg)] hover:bg-[var(--mp-surface-raised)] transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
