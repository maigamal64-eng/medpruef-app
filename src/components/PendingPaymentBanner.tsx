'use client';
/**
 * Pending payment strip (UX-ACC-07) on Home, /pricing and Settings.
 *
 * A checkout redirect without a grant is a hand-off, not proof of payment.
 * While it resolves the server refuses a second checkout (CHECKOUT_PENDING),
 * so this strip says so, offers "Zahlung prüfen" (verify) and help, and tells
 * the page through `onPendingChange` to guard its pay buttons. "Mit anderer
 * Karte bezahlen" runs verify first: inside the settle window it explains the
 * wait instead of linking into a refusal. Once verify gives a final no-payment
 * answer (the success page's rule: membership_not_found and settled, or the
 * guard window for trials) the strip says plainly that no payment arrived and
 * offers "Erneut versuchen". At the 24 hour ceiling it verifies once; without
 * a final answer it keeps the by-hand line, never a claim that nothing arrived. Announced once per payment (role=status), never colour-only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { getStoredSession } from '@/lib/auth';
import { t, useLang } from '@/lib/i18n';
import { BILLING_SUPPORT_EMAIL } from '@/lib/billing-copy';
import { BILLING_MAIL_SUBJECT, pendingStripView, verifyAbsentFinal } from '@/lib/checkout-pending';
import { verifyOutcome } from '@/lib/checkout-return';
import { safeSessionStorage } from '@/lib/safe-storage';
import { createActionGate } from '@/lib/account-request';
import { isCardTrialTier } from '@/lib/card-trial';

type Pending = { tier: string; reference: string | null; created_at: string; extends_from?: string | null; expired?: boolean };

export default function PendingPaymentBanner({ onPendingChange }: { onPendingChange?: (pending: boolean) => void } = {}) {
  const lang = useLang();
  const de = lang === 'de';
  const [pending, setPending] = useState<Pending | null>(null);
  const [absent, setAbsent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState(false);
  const [waitLine, setWaitLine] = useState(false);
  const gate = useRef(createActionGate(10_000));
  const absentRef = useRef(false);
  const lastPending = useRef<Pending | null>(null);
  const firstNoPaymentAt = useRef<number | null>(null);
  const ceilingChecked = useRef<string | null>(null);
  const onChange = useRef(onPendingChange);
  useEffect(() => { onChange.current = onPendingChange; }, [onPendingChange]);
  useEffect(() => { if (pending) lastPending.current = pending; onChange.current?.(pendingStripView(pending, absent) === 'pending'); }, [pending, absent]);

  const load = useCallback(async () => {
    if (!getStoredSession()?.user.id || absentRef.current) return;
    try {
      const response = await authFetch('/api/whop/checkout/status', { timeoutMs: 8_000 });
      if (!response.ok) return;
      const value = await response.json();
      if (value.pending === null) { setPending(null); return; }
      if (value.pending && typeof value.pending.tier === 'string' && typeof value.pending.created_at === 'string') setPending(value.pending);
    } catch { /* A failed status read cannot clear an existing pending strip. */ }
  }, []);
  useEffect(() => {
    void load();
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(() => void load(), 60_000);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  useEffect(() => {
    if (!pending) return;
    const user = getStoredSession()?.user.id;
    const key = `medpruef_payment_announced:${user}:${pending.reference || pending.created_at}`;
    if (!safeSessionStorage.getItem(key)) { setAnnouncement(t('account_pending_strip', lang)); safeSessionStorage.setItem(key, '1'); }
  }, [pending, lang]);

  /** Runs verify; resolves 'granted' | 'absent' | 'pending'. */
  const verify = useCallback(async (): Promise<'granted' | 'absent' | 'pending' | 'error'> => {
    if (!pending || !gate.current.enter()) return 'pending';
    setChecking(true); setError(false);
    try {
      const response = await authFetch(isCardTrialTier(pending.tier) ? '/api/whop/trial/verify' : '/api/whop/checkout/verify', {
        method: 'POST', timeoutMs: 15_000, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: pending.tier, ...(pending.extends_from ? { extends_from: pending.extends_from } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw Error('Unavailable');
      if (data.granted === true) { setPending(null); window.dispatchEvent(new Event('medpruef:payment-resolved')); return 'granted'; }
      if (verifyOutcome(true, data) === 'no_payment') {
        const now = Date.now();
        if (firstNoPaymentAt.current === null) firstNoPaymentAt.current = now;
        if (verifyAbsentFinal({ tier: pending.tier, createdAt: pending.created_at, settled: data.settled, firstNoPaymentAt: firstNoPaymentAt.current, now, trial: isCardTrialTier(pending.tier) })) {
          absentRef.current = true; setPending(null); setAbsent(true); window.dispatchEvent(new Event('medpruef:payment-resolved'));
          return 'absent';
        }
      }
      return 'pending';
    } catch { setError(true); return 'error'; }
    finally { gate.current.leave(); setChecking(false); }
  }, [pending]);

  useEffect(() => {
    if (!pending?.expired) return;
    const key = pending.reference || pending.created_at;
    if (ceilingChecked.current === key) return;
    ceilingChecked.current = key;
    void verify();
  }, [pending, verify]);

  if (!pending && !absent) return null;
  const helpHref = `mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent(BILLING_MAIL_SUBJECT)}&body=${encodeURIComponent(`tier: ${(pending ?? lastPending.current)?.tier ?? ''}\nreference: ${(pending ?? lastPending.current)?.reference || ''}`)}`;
  const otherCard = async () => {
    const result = await verify();
    if (result === 'absent') { window.location.hash = 'plans'; return; }
    if (result === 'pending') setWaitLine(true);
  };

  if (pendingStripView(pending, absent) === 'absent') {
    return <section className="mp-card p-4 m-4 text-sm space-y-2" aria-label={t('account_payment_absent_line', lang)}>
      <p role="status">{t('account_payment_absent_line', lang)}</p>
      <div className="flex flex-wrap gap-3">
        <a className="mp-btn mp-btn--secondary min-h-11" href="/pricing#plans">{t('account_checkout_try_again', lang)}</a>
        <a className="min-h-11 inline-flex items-center underline" href={helpHref}>{de ? 'Hilfe' : 'Help'}</a>
      </div>
    </section>;
  }
  return <section className="mp-card p-4 m-4 text-sm space-y-2" aria-label={t('account_pending_strip', lang)}>
    <span role="status" className="sr-only">{announcement}</span>
    <p className="font-semibold">{t(pending?.expired ? 'account_pending_ceiling' : 'account_pending_strip', lang)}</p>
    {!pending?.expired && <p>{t('account_do_not_pay_again', lang)}</p>}
    {pending?.reference && <p className="break-all">{de ? 'Referenz' : 'Reference'}: <bdi>{pending.reference}</bdi></p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" className="mp-btn mp-btn--secondary min-h-11" aria-disabled={checking} onClick={() => void verify()}>{checking ? t('account_checking', lang) : de ? 'Zahlung prüfen' : 'Check payment'}</button>
      <a className="min-h-11 inline-flex items-center underline" href={helpHref}>{de ? 'Hilfe' : 'Help'}</a>
      {!pending?.expired && <button type="button" className="min-h-11 inline-flex items-center underline" aria-disabled={checking} onClick={() => void otherCard()}>{t('account_other_card', lang)}</button>}
    </div>
    {!pending?.expired && <p className="text-[var(--mp-fg-muted)]">{t('account_other_card_help', lang)}</p>}
    {waitLine && <p role="status">{t('account_other_card_wait', lang)}</p>}
    {error && <p role="alert" className="text-[var(--mp-error-text)]">{t('request_error', lang)}</p>}
  </section>;
}
