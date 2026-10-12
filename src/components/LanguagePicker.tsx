"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Globe } from 'lucide-react';
import { LANG_LABELS, setLang, t, useLang, type Lang } from '@/lib/i18n';
import { KNOWN_LANGS, REVIEWED_LANGS, renderLang } from '@/lib/language-model';
import { getStoredSession, storeSession } from '@/lib/auth';
import { authFetch } from '@/lib/authFetch';

/**
 * UX-ACC-01: while a language's money and account screens still fall back to
 * English, its option says so in that language's own words. Arabic keeps the
 * existing "(English)" note: no new Arabic strings until [name] signs off.
 */
export const LANGUAGE_COVERAGE_NOTE: Partial<Record<Lang, string>> = {
  ru: 'частично на английском',
  uk: 'частково англійською',
  tr: 'kısmen İngilizce',
  ar: 'English',
};

/** Native name plus the coverage note for not-yet-reviewed languages. */
export function languageOptionLabel(value: Lang): string {
  const note = REVIEWED_LANGS.includes(value) ? undefined : LANGUAGE_COVERAGE_NOTE[value] ?? 'English';
  return note ? `${LANG_LABELS[value]} (${note})` : LANG_LABELS[value];
}

/** "Sprache" in the rendered language (de or en until native review). */
function languageWord(value: Lang): string {
  return renderLang(value) === 'de' ? 'Sprache' : 'Language';
}

const RETRY_DELAY_MS = 1500;

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
  // Only the latest choice may report a failed save.
  const requestSeq = useRef(0);
  const options = settings ? KNOWN_LANGS : REVIEWED_LANGS;

  const patchLanguage = async (next: Lang, account: string): Promise<boolean> => {
    const response = await authFetch('/api/user/language', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: next }), skipAuthRedirect: true,
    });
    if (!response.ok) throw new Error('Language sync failed');
    const session = getStoredSession();
    if (session?.user.id === account) storeSession({ ...session, user: { ...session.user, language_code: next } });
    return true;
  };

  const choose = async (next: Lang) => {
    setLang(next);
    onChange?.(next === 'de' ? 'de' : 'en');
    setAnnouncement(t('language_changed', next));
    setSyncFailed(false);
    const seq = ++requestSeq.current;
    const account = getStoredSession()?.user.id;
    if (!account || account.startsWith('guest_')) return;
    // A failed save retries once on its own before the manual retry shows.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        if (seq !== requestSeq.current || getStoredSession()?.user.id !== account) return;
      }
      try {
        await patchLanguage(next, account);
        return;
      } catch { /* retry once, then offer the manual retry */ }
    }
    if (seq === requestSeq.current) setSyncFailed(true);
  };

  // UX-ACC-01: in Settings the trigger's visible text is "Sprache: Deutsch"
  // and its accessible name is the same string.
  const triggerName = `${languageWord(lang)}: ${languageOptionLabel(lang)}`;
  return (
    <div className={`min-w-0 max-w-full ${className}`}>
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className="relative flex min-h-11 min-w-0 items-center gap-1 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-2 text-sm text-[var(--mp-fg)]">
          <Globe className="h-4 w-4 shrink-0" aria-hidden />
          {compact && <span aria-hidden>{lang.toUpperCase()}</span>}
          {settings && !compact && <span aria-hidden className="shrink-0">{languageWord(lang)}:</span>}
          <select id={id} value={lang} aria-label={triggerName} aria-describedby={`${id}-helper`}
            className={compact ? 'absolute inset-0 h-full w-full cursor-pointer opacity-0' : 'min-h-11 min-w-0 max-w-[14rem] bg-transparent text-[var(--mp-fg)]'}
            onChange={event => void choose(event.target.value as Lang)}>
            {!options.includes(lang) && <option value={lang} lang={lang}>{languageOptionLabel(lang)}</option>}
            {options.map(value => <option key={value} value={value} lang={value}>{languageOptionLabel(value)}</option>)}
          </select>
        </label>
        {!compact && lang !== 'de' && <button type="button" className="min-h-11 px-2 text-sm text-[var(--mp-accent-text)] underline" onClick={() => void choose('de')}>Deutsch</button>}
      </div>
      <p id={`${id}-helper`} className={compact || settings ? "sr-only" : "mt-1 max-w-56 text-xs text-[var(--mp-fg-muted)]"}>{t('language_helper', lang)}</p>
      {unavailable && lang !== 'de' && <p className={compact ? "sr-only" : "mt-1 max-w-56 text-xs text-[var(--mp-fg-muted)]"}>{t("language_unavailable", lang)}</p>}
      {syncFailed && <button type="button" className="min-h-11 text-xs text-[var(--mp-error-text)]" onClick={() => void choose(lang)}>{t('language_sync_failed', lang)}</button>}
      <span role="status" className="sr-only">{announcement}</span>
    </div>
  );
}
