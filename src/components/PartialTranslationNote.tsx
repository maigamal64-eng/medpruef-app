'use client';
import { t, useLang } from '@/lib/i18n';
export default function PartialTranslationNote() {
  const lang = useLang();
  if (lang === 'de' || lang === 'en') return null;
  return <p lang="en" dir="ltr" role="status" className="mp-small rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2">{t('language_fallback', lang)}</p>;
}
