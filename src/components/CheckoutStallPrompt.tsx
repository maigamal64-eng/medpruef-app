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
 * Dismiss (X, "Nein danke"): a 30-day localStorage cooldown so it does not
 * nag. A card or page error answer offers the same plan again and help; a
 * price or undecided answer offers only the free path (UX-ACC-29). Answering: never shows again — enforced server-side via the
 * `user_feedback` row the eligibility check reads, so it holds across
 * devices without needing a local flag.
 */

import { useEffect, useRef, useState } from "react";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { X, Send } from "lucide-react";
import { createFeedbackSubmission } from "@/lib/checkout-feedback-submit";
import { authFetch } from "@/lib/authFetch";
import { t, useLang, type TranslationKey } from "@/lib/i18n";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import { FREE_TIER } from "@/lib/content-truth";

const DISMISS_KEY = "medpruef_checkout_stall_dismissed_at";
/** "Nein danke" is honoured for 30 days (UX-ACC-29). */
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
/** The "I paid" recovery chip runs payment verification; default off (HOME-44). */
const RECOVERY_ENABLED = process.env.NEXT_PUBLIC_CHECKOUT_RECOVERY_ENABLED === "true";
const PLAN_ANCHOR: Record<string, string> = { first_month_19: "first-month", first_3mo_27: "three-months", premium_pass_guaranteed: "cohort", notes_pro_trial: "pro-test" };
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

export default function CheckoutStallPrompt({ onVisibleChange }: { onVisibleChange?: (visible: boolean) => void } = {}) {
  const lang = useLang();
  const [eligible, setEligible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const granted = useAnnouncementSlot("checkout_stall", checked && eligible && !dismissed);
  // UX-HOME-44: while the recovery card shows, it owns Home's single filled primary.
  useEffect(() => { onVisibleChange?.(granted); }, [granted, onVisibleChange]);
  const [selectedReason, setSelectedReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  const otherInput = useRef<HTMLInputElement>(null);
  const thanks = useRef<HTMLDivElement>(null);
  const sender = useRef(createFeedbackSubmission(body => authFetch('/api/checkout-feedback', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), skipAuthRedirect: true, timeoutMs: 8_000,
  })));

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
        const status = await authFetch('/api/whop/checkout/status', { timeoutMs: 8_000, skipAuthRedirect: true });
        const payment = status.ok ? await status.json() : null;
        if (cancelled) return;
        setEligible(Boolean(data?.eligible) && payment?.pending === null);
        setTier(typeof data?.tier === "string" ? data.tier : null);
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
    dismissSurface("checkout_stall", "later");
    setDismissed(true);
  };

  const handleSubmit = async (reason: Reason, sendOther = false) => {
    if (sender.current.pending()) return;
    setSelectedReason(reason);

    // "Other" opens the optional text field first; every other reason
    // submits immediately on tap.
    if (reason === "other" && !sendOther) {
      return;
    }

    setSubmitting(true); setSubmitError(false);
    const result = await sender.current.send(reason, details, typeof window !== 'undefined' ? window.location.pathname : undefined);
    if (result === 'saved') setAnswered(true);
    else if (result === 'failed') setSubmitError(true);
    setSubmitting(false);
  };

  const handleSubmitOther = () => {
    void handleSubmit("other", true);
  };
  useEffect(() => { if (selectedReason === "other" && !answered) otherInput.current?.focus(); }, [selectedReason, answered]);
  useEffect(() => { if (answered) thanks.current?.focus(); }, [answered]);
  const de = lang === "de";
  const retryHref = `/pricing#${(tier && PLAN_ANCHOR[tier]) || "plans"}`;

  // UX-GLOBAL-12: checkout follow-up ranks after access and renewal.
  if (!granted) return null;

  return (
    <section
      className="mp-card rounded-2xl p-4 mb-6 relative"
      aria-label={t("checkout_stall_title", lang)}
    >
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-2 end-2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-lg text-[var(--mp-fg-subtle)] hover:bg-[var(--mp-surface-sunken)] hover:text-[var(--mp-fg)]"
        aria-label={de ? "Nein danke, ausblenden" : "No thanks, hide"}
      >
        <X className="w-4 h-4" aria-hidden />
      </button>

      {answered ? (
        <div ref={thanks} tabIndex={-1} role="status" className="pe-10 outline-none space-y-2">
          <p className="text-sm font-semibold text-[var(--mp-fg)] m-0">{t("checkout_stall_thanks_title", lang)}</p>
          {(selectedReason === "card_not_accepted" || selectedReason === "page_error") ? (
            <>
              <p className="text-sm text-[var(--mp-fg-muted)] m-0">{t("account_retry_card", lang)}</p>
              <div className="flex flex-wrap gap-3">
                <a className="mp-btn mp-btn--secondary min-h-11" href={retryHref}>{t("account_retry_payment", lang)}</a>
                <a className="inline-flex min-h-11 items-center text-sm underline" href={`mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent(de ? "Hilfe zur Zahlung" : "Payment help")}`}>{t("account_write_us", lang)}</a>
              </div>
            </>
          ) : (selectedReason === "price" || selectedReason === "changed_mind") ? (
            <>
              <p className="text-sm text-[var(--mp-fg-muted)] m-0">{de ? `Sie können jederzeit kostenlos weiterüben: ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank, ohne Karte.` : `You can keep practising for free at any time: ${FREE_TIER.questions_per_exam_type} questions per question bank, no card.`}</p>
              <a className="inline-flex min-h-11 items-center text-sm underline" href="/quiz">{de ? "Kostenlos weiterüben" : "Keep practising for free"}</a>
            </>
          ) : (
            <p className="text-sm text-[var(--mp-fg-muted)] m-0">
              {t("checkout_stall_thanks_body", lang)}{" "}
              <a className="underline" href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a>
            </p>
          )}
        </div>
      ) : (
        <div className="pe-10">
          <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{t("checkout_stall_title", lang)}</p>
          <p className="text-sm text-[var(--mp-fg-muted)] mb-3 leading-relaxed">{t("checkout_stall_body", lang)}</p>

          <div className="flex flex-wrap gap-2">
            {RECOVERY_ENABLED && tier && (
              <a href={`/checkout/success?${tier === "notes_pro_trial" ? "trial=1" : `tier=${encodeURIComponent(tier)}`}`} className="mp-btn mp-btn--primary mp-btn--sm min-h-11">
                {t("account_paid_but_inactive", lang)}
              </a>
            )}
            {REASONS.filter((r) => r !== "other").map((reason) => (
              <button
                key={reason}
                type="button"
                onClick={() => void handleSubmit(reason)}
                aria-disabled={submitting}
                className="mp-btn mp-btn--secondary mp-btn--sm min-h-11"
              >
                {t(REASON_KEY[reason], lang)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { if (!sender.current.pending()) setSelectedReason("other"); }}
              aria-disabled={submitting}
              aria-expanded={selectedReason === "other"}
              className="mp-btn mp-btn--ghost mp-btn--sm min-h-11"
            >
              {t(REASON_KEY.other, lang)}
            </button>
          </div>

          {submitError && <p role="alert" className="text-sm text-[var(--mp-error-text)] mt-2">{t("checkout_stall_failed", lang)}</p>}
          {selectedReason === "other" && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <label className="flex-1 text-sm">
                <span className="block mb-1 text-[var(--mp-fg)]">{t("checkout_stall_details_placeholder", lang)}</span>
                <input
                  ref={otherInput}
                  type="text"
                  value={details}
                  onChange={(e) => setDetails(e.target.value.slice(0, 500))}
                  className="w-full min-h-11 text-sm bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] border border-[var(--mp-border-control)] rounded-xl px-3 py-2"
                  maxLength={500}
                />
              </label>
              <button
                type="button"
                onClick={handleSubmitOther}
                aria-disabled={submitting}
                className="mp-btn mp-btn--primary mp-btn--sm min-h-11 self-end justify-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" aria-hidden />
                {t(submitting ? "checkout_stall_sending" : "checkout_stall_submit", lang)}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
