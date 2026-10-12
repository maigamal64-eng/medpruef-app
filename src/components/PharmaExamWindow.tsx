"use client";

import { useEffect, useState } from 'react';
import { pharmaDate, pharmaWindow } from '@/lib/pharma-window';

export default function PharmaExamWindow({ lang }: { lang: 'de' | 'en' }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    refresh();
    const timer = setInterval(refresh, 60_000);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('pageshow', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const selected = pharmaWindow(now);
  if (!selected) return <p className="text-sm text-[var(--mp-fg-muted)]">{lang === 'de' ? 'Frag deine Universität nach der nächsten Prüfungswoche.' : 'Ask your university for the next exam week.'}</p>;
  const { current, open, next } = selected;
  const week = `${pharmaDate(current.date, lang)} ${lang === 'de' ? 'bis' : 'to'} ${pharmaDate(current.date_end || current.date, lang)}`;
  return <section className="mp-card p-4 sm:p-6 space-y-2" aria-labelledby="pharma-week">
    <h2 id="pharma-week" className="mp-h3">Rezeptierkunde {lang === 'de' ? 'und' : 'and'} Gerichtsmedizin</h2>
    <p className="text-[var(--mp-fg)]">{lang === 'de' ? 'Nächste Prüfungswoche' : 'Next exam week'}: {week}</p>
    <p className="text-sm text-[var(--mp-fg-muted)]" role="status">{open
      ? `${lang === 'de' ? 'Anmeldeschluss' : 'Registration closes'}: ${pharmaDate(current.registration_closes!, lang)}, ${current.closes_at_time} ${lang === 'de' ? 'Uhr (Wien)' : '(Vienna time)'}`
      : `${lang === 'de' ? 'Anmeldung geschlossen' : 'Registration closed'}${next ? `. ${lang === 'de' ? 'Nächste veröffentlichte Prüfungswoche' : 'Next published exam week'}: ${pharmaDate(next.date, lang)} ${lang === 'de' ? 'bis' : 'to'} ${pharmaDate(next.date_end || next.date, lang)}` : ''}.`}</p>
    <p className="text-sm text-[var(--mp-fg-muted)]">{lang === 'de' ? 'Die Termine richten sich nach den Semesterprüfungswochen der MedUni Wien. Bestätige das Prüfungsformat mit deiner Universität.' : 'Dates follow MedUni Vienna semester exam weeks. Confirm the exam format with your university.'}</p>
    <a href={current.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-[var(--mp-accent-text)] underline">{current.publisher}, {lang === 'de' ? 'gelesen am' : 'read on'} {pharmaDate(current.read_on, lang)}</a>
  </section>;
}
