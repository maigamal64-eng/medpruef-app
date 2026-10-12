'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authFetch';
import { getStoredSession } from '@/lib/auth';
import { t, useLang } from '@/lib/i18n';
import { BILLING_SUPPORT_EMAIL } from '@/lib/billing-copy';
import { safeSessionStorage } from '@/lib/safe-storage';
import { createActionGate } from '@/lib/account-request';

type Pending = { tier: string; reference: string | null; created_at: string; expired?: boolean };
export default function PendingPaymentBanner() {
  const lang = useLang();
  const [pending, setPending] = useState<Pending | null>(null);
  const [absent, setAbsent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState(false);
  const gate = useRef(createActionGate(10_000));
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
  if (!pending && !absent) return null;
  const check = async () => {
    if (!pending || !gate.current.enter()) return;
    setChecking(true); setError(false);
    try {
      const response = await authFetch(pending.tier === 'notes_pro_trial' ? '/api/whop/trial/verify' : '/api/whop/checkout/verify', {
        method: 'POST', timeoutMs: 15_000, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: pending.tier }),
      });
      const data = await response.json();
      if (!response.ok) throw Error('Unavailable');
      if (data.granted === true) { setPending(null); window.dispatchEvent(new Event('medpruef:payment-resolved')); }
      else if (data.reason === 'payment_not_found' || data.reason === 'membership_not_found') {
        setPending(null); setAbsent(true); window.dispatchEvent(new Event('medpruef:payment-resolved'));
      } else setError(true);
    } catch { setError(true); }
    finally { gate.current.leave(); setChecking(false); }
  };
  return <section className="mp-card p-4 m-4 text-sm space-y-2" aria-label={t('account_pending_strip', lang)}>
    <span role="status" className="sr-only">{announcement}</span>
    <p>{t(absent ? 'account_payment_absent' : pending?.expired ? 'account_pending_ceiling' : 'account_pending_strip', lang)}</p>
    {pending && <>
      {pending.reference && <p className="break-all"><bdi>{pending.reference}</bdi></p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="mp-btn mp-btn--secondary min-h-11" aria-disabled={checking} onClick={() => void check()}>{t(checking ? 'account_checking' : 'account_check_again', lang)}</button>
        <a className="min-h-11 inline-flex items-center underline" href={`mailto:${BILLING_SUPPORT_EMAIL}?subject=MedPr%C3%BCf%20payment&body=${encodeURIComponent(`tier: ${pending.tier}\nreference: ${pending.reference || ''}`)}`}>{t('account_payment_help', lang)}</a>
        <Link href="/pricing#first-month" className="min-h-11 inline-flex items-center underline">{t('account_other_card', lang)}</Link>
      </div>
      <p>{t('account_other_card_help', lang)}</p>
      {error && <p role="alert" className="text-[var(--mp-error)]">{t('request_error', lang)}</p>}
    </>}
  </section>;
}
