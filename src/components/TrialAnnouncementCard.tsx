"use client";
import { t, type Lang } from "@/lib/i18n";
import { billingTrialLine, VERIFIED_CANCEL_PATH } from "@/lib/billing-copy";

/** Returning-free-user trial announcement. Shared queue, feature eligibility and
 * exact terms must all be known. Per-account dismissal persists locally. */

import { useAnnouncementGate } from "@/lib/announcements/useAnnouncementGate";
import { canShowHomeTrial, type HomeTrialTerms } from "@/lib/home-trial-announcement";
import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Sparkles, X, CreditCard } from "lucide-react";





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
  const queue = useAnnouncementGate();
  const [state, setState] = useState<HomeTrialTerms | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(true); // fail-closed until checked

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

    let cancelled = false;
    setLoading(true);
    setState(null);
    fetch("/api/whop/trial", { skipAuthRedirect: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: HomeTrialTerms | null) => {
        if (!cancelled && d) setState(d);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, isGuest]);

  const dismiss = () => {
    try {
      localStorage.setItem(dismissKey(userId), "1");
    } catch {
      /* ignore — non-persistent dismiss for this session's render only */
    }
    setDismissed(true);
  };

  if (isGuest || loading || dismissed || !state) return null;
  if (!canShowHomeTrial(state, { ready: !queue.loading && queue.state?.userId === userId, answered: queue.state?.qsAnsweredTotal ?? 0, activeSurface: queue.activeSurface })) return null;


  return (
    <div
      className={
        "relative flex items-start gap-3 rounded-[var(--mp-r-card)] border p-4 " +
        "border-[var(--mp-viridian)]/30 bg-gradient-to-br from-[var(--mp-viridian)]/10 " +
        "to-[var(--mp-accent-teal)]/5 " +
        className
      }
      role="region"
      aria-label={t("home_trial_announcement", lang)}
    >
      <span className="w-9 h-9 rounded-xl bg-[var(--mp-viridian)]/15 flex items-center justify-center text-[var(--mp-viridian)] flex-shrink-0">
        <Sparkles className="w-5 h-5" />
      </span>

      <div className="min-w-0 flex-1 pe-8">
        <p className="font-display font-bold text-[var(--mp-fg)]">
          {t("home_trial_title", lang).replace("{n}", String(state.trial_days))}
        </p>
        <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
          {billingTrialLine(lang === "de" ? "de" : "en", { trialDays: state.trial_days, priceAfterCents: state.price_after_cents, chargeAt: state.charge_at })}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => { window.location.href = "/pricing?intent=trial#pro-test"; }}
            className="mp-btn mp-btn--primary min-h-11 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <CreditCard className="w-4 h-4" />
            {t("home_trial_terms", lang)}
          </button>
          <span className="text-xs text-[var(--mp-fg-light)]">
            {t("home_trial_provider", lang)}
          </span>
        </div>

        {VERIFIED_CANCEL_PATH && <a className="min-h-11 inline-flex items-center underline" href="/faq#cancellation">{t("home_cancel_help", lang)}</a>}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label={t("close", lang)}
        className="absolute top-1 end-1 min-h-11 min-w-11 p-1 mp-focusable rounded-lg text-[var(--mp-fg-light)] hover:text-[var(--mp-fg)] hover:bg-[var(--mp-surface-raised)] transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
