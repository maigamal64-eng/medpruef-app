"use client";

/**
 * CheckoutStallPrompt — one-tap in-app question for users who recently
 * reached Whop checkout and never completed (2026-07-11).
 *
 * The only channel that reaches the two warm stalled buyers who were
 * in-app today, and it instruments the #1 open business question: why do
 * buyers freeze at card entry.
 *
 * Renders nothing until GET /api/checkout-feedback/eligibility returns
 * `eligible: true` (server-side gate — see that route for the full
 * predicate: recent checkout_redirected, no grant since, never asked
 * before, no paid access). Not a modal — a compact MPDS card, dismissible.
 *
 * Dismiss (X): a 7-day localStorage cooldown so it doesn't nag every
 * session. Answering: never shows again — enforced server-side via the
 * `user_feedback` row the eligibility check reads, so it holds across
 * devices without needing a local flag.
 */

import { useEffect, useState } from "react";
import { X, Send } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { t, useLang, type TranslationKey } from "@/lib/i18n";

const DISMISS_KEY = "medpruef_checkout_stall_dismissed_at";
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

type Reason = "card_not_accepted" | "page_error" | "changed_mind" | "price" | "other";

const REASONS: Reason[] = ["card_not_accepted", "page_error", "changed_mind", "price", "other"];

const REASON_KEY: Record<Reason, TranslationKey> = {
  card_not_accepted: "checkout_stall_reason_card",
  page_error: "checkout_stall_reason_page_error",
  changed_mind: "checkout_stall_reason_changed_mind",
  price: "checkout_stall_reason_price",
  other: "checkout_stall_reason_other",
};

function isDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return false;
    return Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export default function CheckoutStallPrompt() {
  const lang = useLang();
  const [eligible, setEligible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selectedReason, setSelectedReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    setDismissed(isDismissedRecently());

    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/checkout-feedback/eligibility", {
          skipAuthRedirect: true,
        });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setEligible(Boolean(data?.eligible));
      } catch {
        /* non-critical — card silently hides if we can't fetch */
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* non-critical */
    }
    setDismissed(true);
  };

  const handleSubmit = async (reason: Reason) => {
    if (submitting) return;
    setSelectedReason(reason);

    // "Other" opens the optional text field first; every other reason
    // submits immediately on tap.
    if (reason === "other" && !answered) {
      return;
    }

    setSubmitting(true);
    try {
      await authFetch("/api/checkout-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason,
          details: details.trim() || undefined,
          url: typeof window !== "undefined" ? window.location.pathname : undefined,
        }),
        skipAuthRedirect: true,
      });
    } catch {
      /* best-effort — still show thanks, don't block the user on a network blip */
    } finally {
      setSubmitting(false);
      setAnswered(true);
    }
  };

  const handleSubmitOther = () => {
    void handleSubmit("other");
  };

  if (!checked || !eligible || dismissed) return null;

  return (
    <section
      className="mp-card rounded-2xl p-4 mb-6 relative"
      aria-label={t("checkout_stall_title", lang)}
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 rounded-lg text-[var(--mp-fg-subtle)] hover:bg-[var(--mp-surface-sunken)] hover:text-[var(--mp-fg)] transition-colors"
        aria-label={t("checkout_stall_dismiss", lang)}
      >
        <X className="w-4 h-4" />
      </button>

      {answered ? (
        <div className="pr-6">
          <p className="text-sm font-semibold text-[var(--mp-fg)]">
            {t("checkout_stall_thanks_title", lang)}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-1 leading-relaxed">
            {t("checkout_stall_thanks_body", lang)}
          </p>
        </div>
      ) : (
        <div className="pr-6">
          <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
            {t("checkout_stall_title", lang)}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] mb-3 leading-relaxed">
            {t("checkout_stall_body", lang)}
          </p>

          <div className="flex flex-wrap gap-2">
            {REASONS.filter((r) => r !== "other").map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => void handleSubmit(reason)}
                disabled={submitting}
                className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t(REASON_KEY[reason], lang)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedReason("other")}
              disabled={submitting}
              className="mp-btn mp-btn--ghost mp-btn--sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t(REASON_KEY.other, lang)}
            </button>
          </div>

          {selectedReason === "other" && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={details}
                onChange={(e) => setDetails(e.target.value.slice(0, 500))}
                placeholder={t("checkout_stall_details_placeholder", lang)}
                className="flex-1 text-sm bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] border border-[var(--mp-border-subtle)] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--mp-cta-blue)]/50"
                maxLength={500}
              />
              <button
                type="button"
                onClick={handleSubmitOther}
                disabled={submitting}
                className="mp-btn mp-btn--primary mp-btn--sm justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
                {t("checkout_stall_submit", lang)}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
