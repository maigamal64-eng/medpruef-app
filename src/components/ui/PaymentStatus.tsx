'use client';
import { useState } from 'react';
import { Alert } from './Alert';
import { paymentStatusText, type PaymentState } from '@/lib/billing-copy';
import { renderLang, useLang } from '@/lib/i18n';

export function PaymentStatus({ state, check, reference }: { state: PaymentState; check?: () => void; reference?: string | null }) {
  const lang = renderLang(useLang());
  const [copied, setCopied] = useState(false);
  return <Alert variant={state === 'granted' ? 'success' : state === 'failed' ? 'error' : 'info'} title={paymentStatusText(state, lang)}>
    {state !== 'granted' && check && <button type="button" className="mp-btn mp-btn--secondary min-h-11 mt-2" onClick={check}>{lang === 'de' ? 'Zugang prüfen' : 'Check access'}</button>}
    {reference && <div className="mt-2 break-all text-xs"><p>{lang === 'de' ? 'Referenz' : 'Reference'}: <bdi>{reference}</bdi></p><button type="button" className="min-h-11 underline" onClick={async () => { try { await navigator.clipboard.writeText(reference); setCopied(true); } catch { setCopied(false); } }}>{lang === 'de' ? 'Referenz kopieren' : 'Copy reference'}</button><span role="status" className="sr-only">{copied ? lang === 'de' ? 'Referenz kopiert' : 'Reference copied' : ''}</span></div>}
  </Alert>;
}
