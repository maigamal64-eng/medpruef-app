'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authFetch';
import { t } from '@/lib/i18n';
import { Skeleton } from '@/components/ui';
export default function LatestSimulation({ lang }: { lang: 'de' | 'en' }) {
  const [attempt, setAttempt] = useState<{ id: string; score_pct: number } | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setState('loading');
    void authFetch('/api/history/exams?limit=1').then(async res => {
      if (!res.ok) throw new Error('History unavailable');
      const data = await res.json();
      if (!Array.isArray(data?.attempts)) throw new Error('Invalid history');
      const row = data.attempts[0];
      if (row && (typeof row.id !== 'string' || typeof row.score_pct !== 'number')) throw new Error('Invalid attempt');
      if (alive) { setAttempt(row || null); setState('ready'); }
    }).catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [retry]);
  return <div className="mp-card p-4 mb-4 flex flex-wrap items-center gap-3">
    <span className="font-semibold">{t('exam_last_simulation', lang)}</span>
    {state === 'loading' ? <Skeleton variant="text" /> : state === 'error' ? <><span role="alert">{t('exam_history_error', lang)}</span><button className="mp-btn mp-btn--ghost min-h-11" onClick={() => setRetry(n => n + 1)}>{t('home_retry', lang)}</button></> : attempt ? <><span>{Math.round(attempt.score_pct)}%</span><Link className="mp-btn mp-btn--secondary min-h-11" href={`/history?attempt=${encodeURIComponent(attempt.id)}`}>{t('exam_view', lang)}</Link></> : <span>{t('exam_history_empty', lang)}</span>}
    <Link className="mp-btn mp-btn--ghost min-h-11" href="/history">{t('exam_all_history', lang)}</Link>
  </div>;
}
