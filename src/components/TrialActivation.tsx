"use client";
import { t } from "@/lib/i18n";
import { FREE_TIER } from "@/lib/content-truth";
import { createActionGate } from "@/lib/account-request";
import { PaymentStatus } from "./ui/PaymentStatus";
import { billingTrialLine } from "@/lib/billing-copy";

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

import { useEffect, useRef, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Alert } from "@/components/ui";
import Link from "next/link";
import { freeStudyDestination } from "@/lib/auth-entry";
import type { ExamSourceId } from "@/lib/topics";
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
  resume = false,
  exam = "kenntnispruefung",
  checkoutBusy = false,
  onWorkingChange,
}: {
  lang: Lang;
  className?: string;
  resume?: boolean;
  exam?: ExamSourceId;
  checkoutBusy?: boolean;
  onWorkingChange?: (working: boolean) => void;
}) {
  const request = useRef<AbortController | null>(null);
  const actionGate = useRef(createActionGate());
  const onWorking = useRef(onWorkingChange);
  useEffect(() => { onWorking.current = onWorkingChange; }, [onWorkingChange]);
  const [slow, setSlow] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [retry, setRetry] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [state, setState] = useState<TrialState | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    const session = getStoredSession();
    if (!session) {
      setSignedIn(false);
      setLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoading(true); setLoadError(false);
    fetch("/api/whop/trial", { timeoutMs: 8_000, signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TrialState | null) => {
        if (!active) return;
        if (d && typeof d.eligible === "boolean") setState(d);
        else setLoadError(true);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [retry]);

  useEffect(() => {
    if (!resume || loading || !state) return;
    if (!state.eligible || !state.trial_enabled) return;
    button.current?.scrollIntoView({ block: "center" });
    button.current?.focus({ preventScroll: true });
  }, [resume, loading, state, exam]);

  useEffect(() => {
    const reset = () => { request.current?.abort(); actionGate.current.leave(); setPhase('idle'); setSlow(false); onWorking.current?.(false); setRetry(n => n + 1); };
    const visible = () => { if (document.visibilityState === 'visible') reset(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) reset(); };
    document.addEventListener('visibilitychange', visible); window.addEventListener('pageshow', restored);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('pageshow', restored); };
  }, []);
  useEffect(() => {
    if (phase !== 'working') return;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [phase]);
  const start = async () => {
    if (checkoutBusy || !actionGate.current.enter()) return;
    setPhase("working"); setSlow(false); onWorking.current?.(true);
    const controller = new AbortController(); request.current = controller;
    try {
      const res = await fetch("/api/whop/trial", { method: "POST", timeoutMs: 15_000, signal: controller.signal });
      const d = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (res.ok && d?.purchaseUrl) {
        // Redirect to Whop's hosted checkout to link the card.
        window.location.href = d.purchaseUrl;
        return;
      }
      if (d?.code === 'CHECKOUT_PENDING') { setPending(true); setPhase('idle'); return; }
      if (d?.code === "ALREADY_TRIALED" || d?.code === "ALREADY_PRO" || d?.code === "TRIAL_DISABLED") {
        setState((s) => (s ? { ...s, eligible: false, already_trialed: d.code === 'ALREADY_TRIALED', is_pro: d.code === 'ALREADY_PRO' } : s));
        setPhase("idle");
        return;
      }
      setPhase("error");
    } catch {
      if (!controller.signal.aborted) setPhase("error");
    } finally {
      if (request.current === controller) { actionGate.current.leave(); onWorking.current?.(false); }
    }
  };

  if (loadError) return <Alert variant="warning">
    {t('account_trial_load_error', lang)}
    <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => setRetry(value => value + 1)}>{lang === 'de' ? 'Erneut versuchen' : 'Try again'}</button>
    <Link href={freeStudyDestination(exam)} className="mp-btn mp-btn--secondary min-h-12 w-full justify-center">{lang === 'de' ? 'Ohne Karte weiter' : 'Continue without a card'}</Link>
  </Alert>;
  if (!signedIn || loading || !state) return null;
  if (!state.eligible) return resume ? <Alert variant="info">
    <p>{t(state.is_pro ? 'account_trial_paid' : state.already_trialed ? 'account_trial_used' : 'account_trial_load_error', lang)}</p>
    <Link href="/pricing#first-month" className="mp-btn mp-btn--secondary min-h-11">{t('practice_see_plans', lang)}</Link>
    <Link href={freeStudyDestination(exam)} className="mp-btn mp-btn--secondary min-h-11">{t('account_continue', lang)}</Link>
  </Alert> : null;

  const de = lang === "de";
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
            {t('account_trial_title', lang)}
          </p>
          <p className="text-sm text-[var(--mp-fg-muted)] mt-0.5">
            {billingTrialLine(lang, { trialDays: state.trial_days, priceAfterCents: state.price_after_cents })}
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              ref={button}
              type="button"
              onClick={start}
              aria-disabled={phase === "working" || checkoutBusy}
              className="mp-btn mp-btn--primary min-h-11 inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {phase === "working" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              {phase === 'working' ? t('account_trial_redirect', lang) : t('account_trial_start', lang).replace('{n}', String(state.trial_days))}
            </button>
            <span className="text-xs text-[var(--mp-fg-light)]">
              {de ? "Sichere Zahlung über Whop" : "Secure payment via Whop"}
            </span>
          </div>

          <p className="text-sm mt-3 text-[var(--mp-fg-muted)]">{t('account_trial_limit', lang).replace('{n}', String(FREE_TIER.questions_per_exam_type))}</p>
          {phase === 'working' && <p role="status" className="text-sm mt-2">{t('account_checkout_opening', lang)} {t('account_return', lang)}</p>}
          {slow && <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2" onClick={() => { if (phase !== 'working') return; window.location.href = '/checkout/success?trial=1'; }}>{t('account_checkout_retry', lang)}</button>}
          <Link href="/faq#cancellation" className="inline-flex min-h-11 items-center text-sm text-[var(--mp-accent-text)] underline">{de ? 'So kündigst du' : 'How to cancel'}</Link>
          {resume && <Link href={freeStudyDestination(exam)} className="mp-btn mp-btn--secondary min-h-12 mt-2 w-full justify-center">{de ? 'Ohne Karte weiter' : 'Continue without a card'}</Link>}
          {pending && <PaymentStatus state="pending" check={() => { window.location.href = "/checkout/success?trial=1"; }} />}
          {phase === "error" && (
            <p role="alert" className="text-sm text-[var(--mp-error)] mt-2">{t('account_trial_failed', lang)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
