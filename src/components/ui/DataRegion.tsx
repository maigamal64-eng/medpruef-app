'use client';
import { useEffect, useState } from 'react';
import { Alert } from './Alert';
import { Skeleton } from './Skeleton';
import { t, useLang } from '@/lib/i18n';

/** Keep last good content visible while a retry is loading or has failed. */
export function DataRegion({ loading = false, error = false, retry, children }: {
  loading?: boolean; error?: boolean; retry: () => void; children?: React.ReactNode;
}) {
  const lang = useLang();
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const skeletonTimer = setTimeout(() => setShowSkeleton(true), 200);
    const slowTimer = setTimeout(() => setSlow(true), 8_000);
    return () => { clearTimeout(skeletonTimer); clearTimeout(slowTimer); setShowSkeleton(false); setSlow(false); };
  }, [loading]);
  return <section aria-busy={loading}>
    {loading && <span className="sr-only" role="status">{t('loading', lang)}</span>}
    {loading && showSkeleton && !children && <Skeleton variant="card" className="min-h-40" />}
    {loading && slow && <p role="status" className="mp-small">{t('request_slow', lang)}</p>}
    {error && <Alert variant="error" title={t('request_error', lang)} className="my-4">
      {typeof navigator !== 'undefined' && navigator.onLine === false && <p>{lang === 'de' ? 'Du bist offline.' : 'You are offline.'}</p>}
      <button type="button" className="mp-btn mp-btn--secondary mt-2 min-h-11" onClick={retry}>{t('request_retry', lang)}</button>
    </Alert>}
    {children}
  </section>;
}
