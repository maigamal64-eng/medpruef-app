"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { trackPurchase } from "@/lib/conversion-events";
import { renderLang, t, useLang } from "@/lib/i18n";
import { billingAmount, BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import { getStoredSession } from "@/lib/auth";
import { authDestination, readAuthEntry, buildAuthHref } from "@/lib/auth-entry";
import { authFetch } from "@/lib/authFetch";
import { confirmedUnmatchedPayment, createActionGate, PAYMENT_CHECK_CEILING_MS, PAYMENT_CHECK_COOLDOWN_MS, safeCheckoutReference } from "@/lib/account-request";

type Outcome = 'pending' | 'granted' | 'unmatched' | 'failed';
type VerifyPayload = { granted?: boolean; already?: boolean; reason?: string; payment_ref?: string | null; amount_cents?: number | null };

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const lang = renderLang(useLang());
  const { isPaid, isLoading, error: tierError, refresh } = useUserTier();
  const [params, setParams] = useState<URLSearchParams | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>('pending');
  const [paymentRef, setPaymentRef] = useState<string | null>(null);
  const [receiptAmount, setReceiptAmount] = useState<number | null>(null);
  const [paymentSeen, setPaymentSeen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(false);
  const startedAt = useRef(Date.now());
  const gate = useRef(createActionGate(PAYMENT_CHECK_COOLDOWN_MS));
  const purchaseFired = useRef(false);
  const grantedRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    setParams(new URLSearchParams(window.location.search));
    setSignedIn(Boolean(getStoredSession()?.user.id));
    return () => { mounted.current = false; };
  }, []);

  const verify = useCallback(async () => {
    if (!signedIn || !params || grantedRef.current || !gate.current.enter()) return;
    const tier = params.get('tier');
    const trial = params.get('trial') === '1';
    setChecking(true);
    try {
      if (!trial && !tier) { void refresh(); return; }
      const response = await authFetch(trial ? '/api/whop/trial/verify' : '/api/whop/checkout/verify', {
        method: 'POST', timeoutMs: 15_000,
        ...(trial ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier }) }),
      });
      const data: VerifyPayload = await response.json();
      if (!mounted.current) return;
      if (!response.ok) { setOutcome('failed'); return; }
      if (data.granted === true) {
        grantedRef.current = true;
        setOutcome('granted');
        setPaymentRef(data.payment_ref ?? null);
        setReceiptAmount(typeof data.amount_cents === 'number' ? data.amount_cents : null);
        if (!trial && !data.already && !purchaseFired.current && data.payment_ref && typeof data.amount_cents === 'number' && data.amount_cents > 0) {
          purchaseFired.current = true;
          trackPurchase({ tier: tier || 'unknown', valueEur: data.amount_cents / 100, conversionId: data.payment_ref });
        }
        void refresh();
      } else if (data.reason === 'payment_unmatched') {
        setOutcome('unmatched'); setPaymentRef(data.payment_ref ?? null);
        setPaymentSeen(confirmedUnmatchedPayment(data));
      } else {
        setOutcome(data.reason === 'provider_unavailable' || data.reason === 'db_error' || data.reason === 'error' ? 'failed' : 'pending');
      }
    } catch { if (mounted.current) setOutcome('failed'); }
    finally { gate.current.leave(); if (mounted.current) setChecking(false); }
  }, [params, signedIn, refresh]);

  useEffect(() => {
    if (!params || !signedIn) return;
    void verify();
    const tick = setInterval(() => {
      const age = Date.now() - startedAt.current;
      setElapsed(age);
      if (age < PAYMENT_CHECK_CEILING_MS && !grantedRef.current) void verify();
    }, 10_000);
    const visible = () => { if (document.visibilityState === 'visible') void verify(); };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) void verify(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', pageshow);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', visible); window.removeEventListener('pageshow', pageshow); };
  }, [params, signedIn, verify]);

  const granted = outcome === 'granted' || (!isLoading && !tierError && isPaid);
  useEffect(() => {
    if (!granted) return;
    grantedRef.current = true;
    const timer = setTimeout(() => router.replace(authDestination(readAuthEntry())), 1_200);
    return () => clearTimeout(timer);
  }, [granted, router]);

  const reference = paymentRef || (params ? safeCheckoutReference(params) : null);
  const help = `mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent('MedPrüf payment/access')}&body=${encodeURIComponent([
    `tier: ${params?.get('tier') || (params?.get('trial') === '1' ? 'notes_pro_trial' : 'unknown')}`,
    reference ? `reference: ${reference}` : '',
  ].filter(Boolean).join('\n'))}`;
  const title = granted ? (lang === 'de' ? 'Dein Pro-Zugang ist aktiv.' : 'Your Pro access is active.')
    : outcome === 'unmatched' ? t('account_unmatched', lang) : t('account_checking', lang);
  return <main className="min-h-screen px-4 py-12 bg-[var(--mp-surface-sunken)]">
    <div className="mp-card mx-auto max-w-lg p-5 sm:p-8 space-y-4">
      <div role="status" aria-live="polite" className="space-y-3">
        {granted ? <CheckCircle2 aria-hidden className="h-10 w-10 text-[var(--mp-success)]" />
          : outcome === 'pending' && elapsed < 60_000 ? <Loader2 aria-hidden className="h-10 w-10 text-[var(--mp-accent-text)] animate-spin motion-reduce:animate-none" />
          : <Clock aria-hidden className="h-10 w-10 text-[var(--mp-fg-muted)]" />}
        <h1 className="mp-h2">{title}</h1>
        {!granted && <p className="mp-body">{t('account_do_not_pay_again', lang)}</p>}
        {!granted && paymentSeen && <p className="mp-body">{t('account_received_unmatched', lang)}</p>}
        {!granted && elapsed >= 60_000 && <p className="mp-body">{t(elapsed >= PAYMENT_CHECK_CEILING_MS ? 'account_pending_ceiling' : 'account_pending_later', lang)}</p>}
        {outcome === 'failed' && !granted && <p className="text-sm text-[var(--mp-error)]">{t('request_error', lang)}</p>}
      </div>
      {granted && receiptAmount !== null && <p className="mp-small">{lang === 'de' ? 'Bestätigter Betrag' : 'Verified amount'}: <bdi>{billingAmount(receiptAmount, lang)}</bdi></p>}
      {reference && <div className="break-all text-sm"><p>{lang === 'de' ? 'Referenz' : 'Reference'}: <bdi>{reference}</bdi></p>
        <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2" onClick={async () => { try { await navigator.clipboard.writeText(reference); setCopied(true); } catch { setCopied(false); } }}>{lang === 'de' ? 'Referenz kopieren' : 'Copy reference'}</button>
        <span role="status" className="sr-only">{copied ? (lang === 'de' ? 'Referenz kopiert' : 'Reference copied') : ''}</span>
      </div>}
      {!granted && <Link className="mp-btn mp-btn--primary min-h-12 w-full justify-center" href="/">{t('account_continue', lang)}</Link>}
      {!granted && signedIn && <button type="button" aria-disabled={checking || !gate.current.available()} className="mp-btn mp-btn--secondary min-h-11" onClick={() => void verify()}>{t(checking ? 'account_checking' : 'account_check_again', lang)}</button>}
      {!granted && !signedIn && params && <Link className="mp-btn mp-btn--secondary min-h-11" href={buildAuthHref({ next: `/checkout/success?${params.toString()}` }, 'signin_required')}>{lang === 'de' ? 'Einloggen und Zugang prüfen' : 'Sign in to check access'}</Link>}
      <a className="inline-flex min-h-11 items-center text-sm text-[var(--mp-accent-text)] underline" href={help}>{t('account_payment_help', lang)}</a>
    </div>
  </main>;
}
