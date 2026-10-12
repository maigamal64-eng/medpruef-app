import { getUpcomingOfficialFor, hasOfficialWindowStarted, isOfficialWindowOpen, type OfficialSitting, OFFICIAL_SITTINGS } from './exam-dates';

/** Select the current published week even when its registration just closed. */
export function pharmaWindow(now: Date = new Date(), sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS) {
  const rows = getUpcomingOfficialFor({ exams: ['rezeptierkunde'], now }, sittings);
  const current = rows[0];
  if (!current) return null;
  return { current, open: isOfficialWindowOpen(current, now), next: rows[1] ?? null };
}
export function pharmaDate(iso: string, lang: 'de' | 'en'): string {
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-AT' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(new Date(`${iso}T12:00:00Z`));
}

const FAQ_COPY = {
  de: {
    none: 'Die MedUni Wien hat derzeit keine weitere Prüfungswoche für Rezeptierkunde und Gerichtsmedizin veröffentlicht. Bitte prüfen Sie den offiziellen Prüfungskalender.',
    week: (a: string, b: string) => `${a} bis ${b}`,
    open: (close: string, time?: string) => (time ? `Anmeldung bis ${close}, ${time} Uhr (Wien)` : `Anmeldung bis ${close}`),
    closed: (close: string) => `Anmeldung seit ${close} geschlossen`,
    later: (open: string, close: string, time?: string) => `Anmeldung vom ${open} bis ${close}${time ? `, ${time} Uhr (Wien)` : ''}`,
    unknown: 'Anmeldefenster noch nicht veröffentlicht',
    lead: 'Die MedUni Wien veröffentlicht für Rezeptierkunde und Gerichtsmedizin dieselben Prüfungswochen.',
    tail: (publisher: string, read: string) => `Beide Prüfungen werden getrennt mit dem jeweiligen Formular vom MedUni-E-Mail-Konto angemeldet. Weitere Prüfungswochen sind noch nicht veröffentlicht. Quelle: ${publisher}, gelesen am ${read}.`,
  },
  en: {
    none: 'MedUni Vienna has not published a further exam week for Rezeptierkunde and legal medicine yet. Please check the official exam calendar.',
    week: (a: string, b: string) => `${a} to ${b}`,
    open: (close: string, time?: string) => (time ? `register by ${close}, ${time} Vienna time` : `register by ${close}`),
    closed: (close: string) => `registration closed on ${close}`,
    later: (open: string, close: string, time?: string) => `registration from ${open} to ${close}${time ? `, ${time} Vienna time` : ''}`,
    unknown: 'registration window not yet published',
    lead: 'MedUni Vienna publishes the same exam weeks for Rezeptierkunde and legal medicine.',
    tail: (publisher: string, read: string) => `Register for each exam separately with its own form from your MedUni email account. Later exam weeks have not been published yet. Source: ${publisher}, read on ${read}.`,
  },
} as const;

/**
 * FAQ answer for "When is the next Rezeptierkunde exam?" built only from
 * OFFICIAL_SITTINGS (GU-02), so it ages with the calendar instead of
 * holding typed dates. Every row names its own registration window.
 */
export function pharmaNextAnswer(lang: 'de' | 'en', now: Date = new Date(), sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): string {
  const c = FAQ_COPY[lang];
  const rows = getUpcomingOfficialFor({ exams: ['rezeptierkunde'], now }, sittings);
  if (rows.length === 0) return c.none;
  const parts = rows.map((row) => {
    const week = c.week(pharmaDate(row.date, lang), pharmaDate(row.date_end || row.date, lang));
    const close = row.registration_closes ? pharmaDate(row.registration_closes, lang) : null;
    const opens = row.registration_opens ? pharmaDate(row.registration_opens, lang) : null;
    const state = !close ? c.unknown
      : !isOfficialWindowOpen(row, now) ? c.closed(close)
      : opens && !hasOfficialWindowStarted(row, now) ? c.later(opens, close, row.closes_at_time)
      : c.open(close, row.closes_at_time);
    return `${week}: ${state}.`;
  });
  return `${c.lead} ${parts.join(' ')} ${c.tail(rows[0].publisher, pharmaDate(rows[0].read_on, lang))}`;
}
