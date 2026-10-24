'use client';
/**
 * Pending payment strip (UX-ACC-07) on Home, /pricing and Settings.
 *
 * A checkout redirect without a grant is a hand-off, not proof of payment.
 * While it resolves the server refuses a second checkout (CHECKOUT_PENDING),
 * so this strip says so, offers "Zahlung prüfen" (verify) and help, and tells
 * the page through `onPendingChange` to guard its pay buttons. "Mit anderer
 * Karte bezahlen" runs verify first: inside the settle window it explains the
 * wait instead of linking into a refusal. After the 24 hour ceiling only the
 * help line stays. Announced once per payment (role=status), never colour-only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { getStoredSession } from '@/lib/auth';
import { t, useLang } from '@/lib/i18n';
import { BILLING_SUPPORT_EMAIL } from '@/lib/billing-copy';
import { CHECKOUT_SETTLE_MS } from '@/lib/checkout-pending';
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
  const onChange = useRef(onPendingChange);
  useEffect(() => { onChange.current = onPendingChange; }, [onPendingChange]);
  useEffect(() => { onChange.current?.(Boolean(pending && !pending.expired)); }, [pending]);

  const load = useCallback(async () => {
    if (!getStoredSession()?.user.id) return;
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
      if (data.reason === 'payment_not_found' || data.reason === 'membership_not_found') {
        // The server releases the second-checkout guard only after the settle window.
        if (Date.now() - Date.parse(pending.created_at) >= CHECKOUT_SETTLE_MS) {
          setPending(null); setAbsent(true); window.dispatchEvent(new Event('medpruef:payment-resolved'));
          return 'absent';
        }
      }
      return 'pending';
    } catch { setError(true); return 'error'; }
    finally { gate.current.leave(); setChecking(false); }
  }, [pending]);

  if (!pending && !absent) return null;
  const helpHref = `mailto:${BILLING_SUPPORT_EMAIL}?subject=MedPr%C3%BCf%20payment&body=${encodeURIComponent(`tier: ${pending?.tier ?? ''}\nreference: ${pending?.reference || ''}`)}`;
  const otherCard = async () => {
    const result = await verify();
    if (result === 'absent') { window.location.hash = 'plans'; return; }
    if (result === 'pending') setWaitLine(true);
  };

  if (absent) {
    return <section className="mp-card p-4 m-4 text-sm" aria-label={t('account_payment_absent_line', lang)}>
      <p role="status">{t('account_payment_absent_line', lang)}</p>
    </section>;
  }
  return <section className="mp-card p-4 m-4 text-sm space-y-2" aria-label={t('account_pending_strip', lang)}>
    <span role="status" className="sr-only">{announcement}</span>
    <p className="font-semibold">{t(pending?.expired ? 'account_pending_ceiling' : 'account_pending_strip', lang)}</p>
    {!pending?.expired && <p>{t('account_do_not_pay_again', lang)}</p>}
    {pending?.reference && <p className="break-all">{de ? 'Referenz' : 'Reference'}: <bdi>{pending.reference}</bdi></p>}
    <div className="flex flex-wrap gap-3">
      {!pending?.expired && <button type="button" className="mp-btn mp-btn--secondary min-h-11" aria-disabled={checking} onClick={() => void verify()}>{checking ? t('account_checking', lang) : de ? 'Zahlung prüfen' : 'Check payment'}</button>}
      <a className="min-h-11 inline-flex items-center underline" href={helpHref}>{de ? 'Hilfe' : 'Help'}</a>
      {!pending?.expired && <button type="button" className="min-h-11 inline-flex items-center underline" aria-disabled={checking} onClick={() => void otherCard()}>{t('account_other_card', lang)}</button>}
    </div>
    {!pending?.expired && <p className="text-[var(--mp-fg-muted)]">{t('account_other_card_help', lang)}</p>}
    {waitLine && <p role="status">{t('account_other_card_wait', lang)}</p>}
    {error && <p role="alert" className="text-[var(--mp-error-text)]">{t('request_error', lang)}</p>}
  </section>;
}
