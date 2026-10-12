import { getUpcomingOfficialFor, isOfficialWindowOpen, type OfficialSitting, OFFICIAL_SITTINGS } from './exam-dates';

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
