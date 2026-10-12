import { renderLang, type Lang } from './i18n';

const COPY = {
  practice: { de: 'Üben', en: 'Practice' },
  reveal: { de: 'Aufdecken', en: 'Reveal' },
  revealHint: { de: 'Tippen zum Aufdecken', en: 'Tap to reveal' },
  previous: { de: 'Vorherige', en: 'Previous' },
  next: { de: 'Nächste', en: 'Next' },
  skip: { de: 'Überspringen', en: 'Skip' },
  finish: { de: 'Fertig', en: 'Finish' },
  review: { de: 'Notizen wiederholen', en: 'Review notes' },
  ratingLabel: { de: 'Wie gut wusstest du es?', en: 'How well did you know it?' },
  again: { de: 'Nochmal', en: 'Again' },
  hard: { de: 'Schwer', en: 'Hard' },
  good: { de: 'Gut', en: 'Good' },
  easy: { de: 'Einfach', en: 'Easy' },
  saving: { de: 'Bewertung wird gespeichert', en: 'Saving rating' },
  ratingError: { de: 'Bewertung nicht gespeichert. Erneut versuchen.', en: 'Rating not saved. Try again.' },
  migrationHint: { de: 'Zum Wiederholen wähle Üben. Fällige Karten öffnen direkt die Wiederholung.', en: 'Choose Practice to review. Due cards open review directly.' },
  dismissHint: { de: 'Hinweis schließen', en: 'Dismiss hint' },
  loadError: { de: 'Bibliothek konnte nicht geladen werden', en: 'Could not load your library' },
  loadErrorBody: { de: 'Das hat gerade nicht geklappt. Deine bisherigen Antworten sind nicht betroffen.', en: 'That did not work just now. Your earlier answers are not affected.' },
  weakConnection: { de: 'Die Verbindung scheint schwach.', en: 'The connection seems weak.' },
  retry: { de: 'Erneut versuchen', en: 'Try again' },
  loadMore: { de: 'Mehr laden', en: 'Load more' },
  dueError: { de: 'Fällige Notizen konnten nicht geladen werden', en: 'Could not load due notes' },
  dueEntry: { de: 'Heute fällige Notizen', en: 'Notes due today' },
  noDue: { de: 'Heute sind keine Notizen fällig.', en: 'No notes are due today.' },
} as const;

/** Library follows the shared DE/EN rendering policy for partial languages. */
export function libraryP0Copy(key: keyof typeof COPY, lang: Lang): string {
  return COPY[key][renderLang(lang)];
}
export function libraryMigrationHintKey(userId: string): string {
  return `medpruef_lib_read_review_v2_${encodeURIComponent(userId)}`;
}
