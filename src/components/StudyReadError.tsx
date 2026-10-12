'use client';
import { useEffect } from 'react';
import { describeReadFailure } from '@/lib/read-failure';
import { trackEvent } from '@/lib/tracker';
import { Alert } from '@/components/ui/Alert';
import { t } from '@/lib/i18n';

export default function StudyReadError({ page, error, retry, lang }: { page: 'plan' | 'stats' | 'readiness'; error: unknown; retry: () => void; lang: 'de' | 'en' }) {
  useEffect(() => {
    const failure = describeReadFailure(error, typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    trackEvent('error_state_shown', { page: page === 'plan' ? '/study-plan' : page === 'stats' ? '/stats' : 'readiness', status: failure.status, reason: failure.reason });
  }, [page, error]);
  const weakConnection = error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return <Alert variant="error" title={t(page === "plan" ? "study_plan_load_error" : page === "stats" ? "study_stats_load_error" : "study_readiness_load_error", lang)} className="my-4">
    <p>{t('study_read_error_body', lang)}</p>
    {weakConnection && <p className="mt-1">{t('study_connection_weak', lang)}</p>}
    <button type="button" className="mp-btn mp-btn--secondary mt-3 min-h-11" onClick={retry}>{t('request_retry', lang)}</button>
  </Alert>;
}
