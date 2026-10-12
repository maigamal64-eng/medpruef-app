'use client';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { billingAmount } from '@/lib/billing-copy';
import { renderLang, useLang } from '@/lib/i18n';
import { DataRegion } from './ui/DataRegion';
import { getStoredSession } from '@/lib/auth';

/** Subscription ledger charge, never an offer price inferred from the selected tier. */
export default function BillingReceipt() {
  const lang = renderLang(useLang());
  const [amount, setAmount] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    if (!getStoredSession()?.user.id) return;
    try {
      const r = await authFetch('/api/user/subscription', { skipAuthRedirect: true });
      if (!r.ok) throw new Error('Receipt unavailable');
      const data = await r.json();
      const cents = data?.subscription?.amount_cents;
      if (data.active && typeof cents === 'number' && Number.isFinite(cents) && data.subscription.currency === 'EUR') setAmount(cents);
      setError(false);
    } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <div id="your-plan" className="scroll-mt-24">
    <DataRegion error={error} retry={() => void load()} />
    {amount !== null && <p className="mp-small py-3">{lang === 'de' ? 'Zuletzt gebuchter Betrag' : 'Last recorded charge'}: <bdi className="tabular-nums">{billingAmount(amount, lang)}</bdi></p>}
    <a className="inline-flex min-h-11 items-center text-sm underline" href="mailto:user-b7e46e80@example.com">{lang === 'de' ? 'Hilfe zu Zahlung oder Zugang' : 'Payment or access help'}</a>
  </div>;
}
