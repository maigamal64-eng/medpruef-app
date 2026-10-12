"use client";

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch } from '@/lib/authFetch';
import { t, useLang } from '@/lib/i18n';
import { BrandedLoader } from '@/components/Logo';

interface Mistake { id: number; question: string; topic: string }
function MistakeList() {
  const params = useSearchParams();
  const examSource = params.get('examSource') || 'kenntnispruefung';
  const topic = params.get('topic');
  // LX-19: the stored preference goes to t(), which renders a reviewed overlay or English.
  const lang = useLang();
  const [rows, setRows] = useState<Mistake[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paywall, setPaywall] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    const p = new URLSearchParams({ examSource, practiceMode: 'wrong', list: '1', limit: '50', offset: String(offset) });
    if (topic) p.set('topic', topic);
    void authFetch(`/api/questions?${p}`).then(async res => {
      if (cancelled) return;
      if (res.status === 402) { setPaywall(true); return; }
      if (!res.ok) throw new Error('Could not load mistakes');
      const data = await res.json();
      if (!cancelled) setRows(Array.isArray(data) ? data : []);
    }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [examSource, topic, offset, retry]);
  const quiz = new URLSearchParams({ examSource, practiceMode: 'wrong' });
  if (topic) quiz.set('topic', topic);
  return <main className="max-w-3xl mx-auto px-4 py-8 space-y-5">
    <Link href="/" className="text-sm underline"><span aria-hidden className="inline-block rtl:rotate-180">←</span> {t('mistakes_back', lang)}</Link>
    <h1 className="text-2xl font-semibold">{t('mistakes_title', lang)}{topic ? `: ${topic}` : ''}</h1>
    <p className="text-sm text-[var(--mp-fg-muted)]">{t('mistakes_intro', lang)}</p>
    {loading ? <div role="status"><BrandedLoader /></div> : paywall ? <div role="status" className="mp-card p-5 rounded-xl space-y-3"><p className="font-semibold">{t('mistakes_paywall_title', lang)}</p><p className="text-sm text-[var(--mp-fg-muted)]">{t('mistakes_paywall_body', lang)}</p><Link className="mp-btn mp-btn--primary min-h-11" href="/pricing?gate=mistakes">{t('mistakes_see_plans', lang)}</Link></div> : error ? <div role="alert"><p>{t('mistakes_load_error', lang)}</p><button className="mp-btn mp-btn--secondary" onClick={() => setRetry(v => v+1)}>{t('mistakes_retry', lang)}</button></div> : <>
      {rows.length > 0 && <Link className="mp-btn mp-btn--primary" href={`/quiz?${quiz}`}>{t('mistakes_review_all', lang)}</Link>}
      {rows.length === 0 && <p>{t('mistakes_none', lang)}</p>}
      <ol className="space-y-3">{rows.map(row => <li key={row.id}><Link className="mp-card block p-4 rounded-xl hover:border-[var(--mp-viridian)]" href={`/quiz?${quiz}&questionId=${row.id}`}><span className="block text-xs text-[var(--mp-fg-muted)]"><span lang="de" dir="ltr">{row.topic}</span> · <bdi dir="ltr">#{row.id}</bdi></span><span className="block mt-1" lang="de" dir="ltr">{row.question}</span><span className="block text-sm underline mt-2">{t('mistakes_review_one', lang)}</span></Link></li>)}</ol>
      <div className="flex gap-3">{offset > 0 && <button className="mp-btn mp-btn--secondary" onClick={() => setOffset(Math.max(0, offset-50))}>{t('mistakes_previous', lang)}</button>}{rows.length === 50 && <button className="mp-btn mp-btn--secondary" onClick={() => setOffset(offset+50)}>{t('mistakes_more', lang)}</button>}</div>
    </>}
  </main>;
}
export default function MistakesPage() { return <Suspense fallback={<BrandedLoader />}><MistakeList /></Suspense>; }
