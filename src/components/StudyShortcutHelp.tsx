"use client";
import { useEffect, useState } from 'react';
import { shouldIgnoreGlobalKey } from '@/lib/keyboard-guard';
import { t } from '@/lib/i18n';
import ShortcutGuide from '@/components/ShortcutGuide';
export default function StudyShortcutHelp({ lang, mode = 'quiz' }: { lang: 'de' | 'en'; mode?: 'quiz' | 'flashcards' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || shouldIgnoreGlobalKey(event) || !window.matchMedia('(pointer: fine) and (min-width: 1024px)').matches) return;
      event.preventDefault(); setOpen(true);
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  return <><button type="button" className="mp-study-shortcut-help mp-btn mp-btn--ghost" onClick={() => setOpen(true)} aria-label={t('shortcut_guide', lang)}>?</button><ShortcutGuide lang={lang} open={open} onClose={() => setOpen(false)} study={mode} /></>;
}
