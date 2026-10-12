/**
 * /curriculum and /stats chrome strings (a25, UX-STU-07, 41, 42, 43, 45, 46, 63).
 * German in Sie, American English, English fallback for every unreviewed
 * language (REVIEWED_LANGS = de, en). Subject names stay German and are not
 * part of this file.
 *
 * ts(key, lang, vars?) never returns a raw key: an unknown language renders
 * English, a missing English string renders German.
 */
import { renderLang, type UiLanguage } from './language-model';
import { LEVEL_COUNT } from './xp';

const STRINGS = {
  // ── /stats ──────────────────────────────────────────────────────────
  stats_title: { de: 'Statistik', en: 'Statistics' },
  stats_subtitle: { de: 'Ihr Stand für die Prüfung', en: 'Your standing for the exam' },
  back: { de: 'Zurück', en: 'Back' },
  share: { de: 'Teilen', en: 'Share' },
  signin_title: { de: 'Bitte melden Sie sich an', en: 'Please sign in' },
  signin_body: {
    de: 'Ihre Statistik (Stufe, Serie, Stärke je Fach) erscheint hier, sobald Sie angemeldet sind und einige Fragen beantwortet haben.',
    en: 'Your statistics (level, streak, strength by subject) appear here once you are signed in and have answered a few questions.',
  },
  to_home: { de: 'Zur Startseite', en: 'Go to home' },

  // STU-41: self-reported pass. No reward or payout line; the saved sentence
  // renders only with a successful pass write receipt.
  pass_title: { de: 'Herzlichen Glückwunsch zur bestandenen Prüfung!', en: 'Congratulations! You passed.' },
  pass_recorded: { de: 'Ihr Ergebnis ist gespeichert.', en: 'We have recorded your result.' },
  pass_retry: { de: 'Ergebnis speichern', en: 'Save your result' },
  pass_dismiss: { de: 'Hinweis schließen', en: 'Dismiss' },

  // STU-42: numbers only, no career names.
  level_region: { de: 'Stufe', en: 'Level' },
  level_of: { de: 'Stufe {n} von {total}', en: 'Level {n} of {total}' },
  level_next: { de: 'bis Stufe {n}', en: 'to level {n}' },
  level_top: { de: 'Höchste Stufe erreicht', en: 'Top level reached' },

  tile_streak: { de: 'Serie', en: 'Streak' },
  unit_days: { de: 'Tage', en: 'days' },
  unit_day: { de: 'Tag', en: 'day' },
  tile_answers: { de: 'Antworten insgesamt', en: 'Total answers' },
  tile_answers_sub: { de: 'mit Wiederholungen', en: 'with repeats' },
  tile_hit_rate: { de: 'Trefferquote', en: 'Hit rate' },
  strength_title: { de: 'Stärke je Fach', en: 'Strength by subject' },
  strength_more: { de: 'Mehr', en: 'More' },
  badge_strong: { de: 'Stark', en: 'Strong' },
  badge_practice_more: { de: 'Mehr üben', en: 'Practice more' },
  correct_total: { de: 'Richtige Antworten insgesamt', en: 'Correct answers in total' },
  longest_streak: { de: 'Längste Serie', en: 'Longest streak' },
  start_simulation: { de: 'Prüfungssimulation starten', en: 'Start exam simulation' },
  empty_title: { de: 'Noch keine Statistik', en: 'No statistics yet' },
  empty_body: {
    de: 'Beantworten Sie Ihre ersten Fragen. Danach sehen Sie hier Ihre Stufe, Ihre Serie und Ihre Stärke je Fach.',
    en: 'Answer your first questions. Your level, streak and strength by subject then appear here.',
  },
  start_first_quiz: { de: 'Erstes Quiz starten', en: 'Start first quiz' },

  // ── /curriculum ─────────────────────────────────────────────────────
  cur_subjects_title: { de: '{exam}: Fächer', en: '{exam}: subjects' },
  cur_subject_count_one: { de: '1 Fach', en: '1 subject' },
  cur_subject_count: { de: '{n} Fächer', en: '{n} subjects' },
  cur_lede_tracked: { de: 'Der Ring zeigt, wie viele verschiedene Fragen Sie gesehen haben.', en: 'The ring shows how many different questions you have seen.' },
  cur_lede_device: { de: 'Antworten werden nur auf diesem Gerät gezählt.', en: 'Answers are counted on this device only.' },
  cur_total_label: { de: 'Fragen in Ihrer Prüfung', en: 'Questions in your exam' },
  cur_seen_headline: { de: 'Verschiedene Fragen gesehen', en: 'Different questions seen' },
  cur_seen_sub: { de: 'ohne Wiederholungen', en: 'without repeats' },
  cur_seen_of: { de: '{seen} von {total}', en: '{seen} of {total}' },
  cur_seen_pct: { de: '{pct} % gesehen', en: '{pct}% seen' },
  cur_ring_pct: { de: '{pct} %', en: '{pct}%' },
  cur_signin_track: { de: 'Melden Sie sich an, um Ihre Abdeckung zu speichern.', en: 'Sign in to track your coverage.' },
  cur_card_seen: { de: '{seen} von {total} gesehen', en: '{seen} of {total} seen' },
  cur_card_correct: { de: '{pct} % richtig', en: '{pct}% correct' },
  cur_card_device: { de: '{n} Antworten auf diesem Gerät', en: '{n} answers on this device' },
  cur_card_aria: { de: '{topic}: {mode}. {detail}', en: '{topic}: {mode}. {detail}' },
  cur_practice: { de: 'Üben', en: 'Practice' },
  cur_mode_unseen: { de: 'Neue Fragen üben', en: 'Practice new questions' },
  cur_mode_review: { de: 'Fällige Wiederholungen üben', en: 'Practice due reviews' },
  cur_mode_all: { de: 'Alle Fragen wiederholen', en: 'Repeat all questions' },
  cur_legend: { de: 'Abdeckung', en: 'Coverage' },
  cur_bucket_well: { de: 'Gut abgedeckt', en: 'Well covered' },
  cur_bucket_progress: { de: 'In Arbeit', en: 'In progress' },
  cur_bucket_none: { de: 'Noch nicht begonnen', en: 'Not started' },
  cur_legend_well: { de: 'Gut abgedeckt (ab 80 %)', en: 'Well covered (80% and up)' },
  cur_legend_progress: { de: 'In Arbeit (1 bis 79 %)', en: 'In progress (1 to 79%)' },
  cur_legend_none: { de: 'Noch nicht begonnen (0 %)', en: 'Not started (0%)' },
  cur_sort_label: { de: 'Sortierung', en: 'Sort' },
  cur_sort_default: { de: 'Reihenfolge im Lehrplan', en: 'Curriculum order' },
  cur_sort_weakest: { de: 'Schwächstes Fach zuerst', en: 'Weakest subject first' },
  cur_all_subjects: { de: 'Alle Fächer', en: 'All subjects' },
  cur_totals_unavailable: { de: 'Die aktuellen Fragenzahlen konnten nicht geladen werden.', en: 'Current question totals could not be loaded.' },
  cur_empty: { de: 'Für diese Prüfung sind noch keine Fächer verfügbar.', en: 'No subjects are available for this exam yet.' },
  cur_pick_error: { de: 'Auswahl nicht gespeichert. Bitte versuchen Sie es erneut.', en: 'Choice not saved. Please try again.' },
} as const;

export type StudyDashKey = keyof typeof STRINGS;
export type StudyDashVars = Record<string, string | number>;

/** Exposed for the copy guard test; never mutate. */
export const STUDY_DASH_STRINGS: Readonly<Record<StudyDashKey, { readonly de: string; readonly en: string }>> = STRINGS;

function isUi(value: unknown): value is UiLanguage {
  return value === 'de' || value === 'en' || value === 'ru' || value === 'uk' || value === 'tr' || value === 'ar';
}

/** The rendered chrome language for a stored preference: de or en. */
export function studyLang(lang: string | null | undefined): 'de' | 'en' {
  return isUi(lang) ? renderLang(lang) : 'en';
}

/** Number locale for the rendered language (de-AT, UX-GLOBAL-03). */
export function studyLocale(lang: string | null | undefined): string {
  return studyLang(lang) === 'de' ? 'de-AT' : 'en-US';
}

/** Grouped number in the rendered language. */
export function studyNum(n: number, lang: string | null | undefined): string {
  return n.toLocaleString(studyLocale(lang));
}

export function ts(key: StudyDashKey, lang: string | null | undefined, vars?: StudyDashVars): string {
  const entry = STRINGS[key] as { de: string; en: string } | undefined;
  if (!entry) return '';
  const rendered = studyLang(lang);
  let text: string = entry[rendered] || entry.en || entry.de;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** STU-42: the rank as a number only ("Stufe 3 von 8"); the level never depends on language. */
export function rankLabel(level: number, lang: string | null | undefined): string {
  const n = Math.min(LEVEL_COUNT, Math.max(1, Math.round(Number.isFinite(level) ? level : 1)));
  return ts('level_of', lang, { n, total: LEVEL_COUNT });
}

/** "Fächer" count with the singular. */
export function subjectCount(n: number, lang: string | null | undefined): string {
  return n === 1 ? ts('cur_subject_count_one', lang) : ts('cur_subject_count', lang, { n });
}
