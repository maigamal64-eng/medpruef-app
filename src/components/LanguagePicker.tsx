"use client";

import { useEffect, useId, useState } from 'react';
import { Globe } from 'lucide-react';
import { LANG_LABELS, setLang, t, useLang, type Lang } from '@/lib/i18n';
import { KNOWN_LANGS, REVIEWED_LANGS } from '@/lib/language-model';
import { getStoredSession, storeSession } from '@/lib/auth';
import { authFetch } from '@/lib/authFetch';

/** Native select lets the OS handle focus, viewport edges and language names. */
export default function LanguagePicker({ className = '', compact = false, settings = false, preferredLanguage, onChange }: {
  className?: string; compact?: boolean; settings?: boolean; preferredLanguage?: Lang; onChange?: (lang: 'de' | 'en') => void;
}) {
  const preference = useLang();
  const lang = preferredLanguage || preference;
  const id = useId();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const browserLanguage = navigator.languages?.[0]?.split("-")[0] || navigator.language.split("-")[0];
    setUnavailable(!["de", "en"].includes(browserLanguage));
  }, []);
  const [announcement, setAnnouncement] = useState('');
  const [syncFailed, setSyncFailed] = useState(false);
  const options = settings ? KNOWN_LANGS : REVIEWED_LANGS;
  const choose = async (next: Lang) => {
    setLang(next);
    onChange?.(next === 'de' ? 'de' : 'en');
    setAnnouncement(t('language_changed', next));
    setSyncFailed(false);
    const account = getStoredSession()?.user.id;
    if (!account || account.startsWith('guest_')) return;
    try {
      const response = await authFetch('/api/user/language', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }), skipAuthRedirect: true,
      });
      if (!response.ok) throw new Error('Language sync failed');
      const session = getStoredSession();
      if (session?.user.id === account) storeSession({ ...session, user: { ...session.user, language_code: next } });
    } catch { setSyncFailed(true); }
  };
  return (
    <div className={`min-w-0 max-w-full ${className}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="relative flex min-h-11 min-w-0 items-center gap-1 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-2 text-sm text-[var(--mp-fg)]">
          <Globe className="h-4 w-4 shrink-0" aria-hidden />
          {compact && <span aria-hidden>{lang.toUpperCase()}</span>}
          <select id={id} value={lang} aria-label={`${t('language_app', lang)}: ${LANG_LABELS[lang]}`} aria-describedby={`${id}-helper`}
            className={compact ? 'absolute inset-0 h-full w-full cursor-pointer opacity-0' : 'min-h-11 min-w-0 max-w-[11rem] bg-transparent text-[var(--mp-fg)]'}
            onChange={event => void choose(event.target.value as Lang)}>
            {!options.includes(lang) && <option value={lang} lang={lang}>{LANG_LABELS[lang]} (English)</option>}
            {options.map(value => <option key={value} value={value} lang={value}>{LANG_LABELS[value]}{!REVIEWED_LANGS.includes(value) ? ' (English)' : ''}</option>)}
          </select>
        </label>
        {!compact && lang !== 'de' && <button type="button" className="min-h-11 px-2 text-sm text-[var(--mp-accent-text)] underline" onClick={() => void choose('de')}>Deutsch</button>}
      </div>
      <p id={`${id}-helper`} className={compact ? "sr-only" : "mt-1 max-w-56 text-xs text-[var(--mp-fg-muted)]"}>{t('language_helper', lang)}</p>
      {unavailable && lang !== 'de' && <p className={compact ? "sr-only" : "mt-1 max-w-56 text-xs text-[var(--mp-fg-muted)]"}>{t("language_unavailable", lang)}</p>}
      {syncFailed && <button type="button" className="min-h-11 text-xs text-[var(--mp-error)]" onClick={() => void choose(lang)}>{t('language_sync_failed', lang)}</button>}
      <span role="status" className="sr-only">{announcement}</span>
    </div>
  );
}
