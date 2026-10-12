'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { getStoredSession } from '@/lib/auth';
import { loadPendingExams } from '@/lib/examSession';
import { t, useLang } from '@/lib/i18n';
import { useFocusMode } from '@/lib/focus-mode';
export default function PendingExamRecovery() {
  const [pending, setPending] = useState(false);
  const path = usePathname();
  const lang = useLang();
  const focus = useFocusMode();
  useEffect(() => {
    const refresh = () => { const account = getStoredSession()?.user.id; setPending(!!account && loadPendingExams(account).length > 0); };
    refresh(); window.addEventListener('storage', refresh); window.addEventListener('mp-exam-pending', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('mp-exam-pending', refresh); };
  }, [path]);
  if (!pending || focus || path === '/exam' || path?.startsWith('/admin') || path === '/login') return null;
  return <div role="status" className="mp-card p-3 mx-4 my-2 text-sm"><span>{t('exam_not_saved', lang)}. </span><Link href="/exam" className="mp-btn mp-btn--secondary min-h-11">{t('exam_retry_save', lang)}</Link></div>;
}
