/**
 * /history chrome strings (a24, UX-EXM-36..42, 49). German in Sie, English
 * fallback for every unreviewed language (REVIEWED_LANGS = de, en). Question
 * stems and options stay German and are not part of this file.
 *
 * th(key, lang, vars?) never returns a raw key: an unknown language renders
 * English, a missing English string renders German.
 */
import { renderLang, type UiLanguage } from './language-model';

const STRINGS = {
  title: { de: 'Verlauf', en: 'History' },
  subtitle_full: { de: 'Ihre gespeicherten Prüfungen und beantworteten Fragen.', en: 'Your saved exams and answered questions.' },
  subtitle_summary: { de: 'Ihre gespeicherten Prüfungen.', en: 'Your saved exams.' },
  tab_exams: { de: 'Prüfungen', en: 'Exams' },
  tab_questions: { de: 'Fragen-Verlauf', en: 'Question history' },
  tabs_label: { de: 'Bereiche im Verlauf', en: 'History sections' },

  stat_best: { de: 'Beste', en: 'Best' },
  stat_latest: { de: 'Letzte', en: 'Latest' },
  stat_count: { de: 'Prüfungen', en: 'Exams' },
  stat_exams_heading: { de: 'Gespeicherte Prüfungen', en: 'Saved exams' },
  stat_quiz_heading: { de: 'Fragen im Quiz', en: 'Questions in practice' },
  stat_answered: { de: 'Beantwortet', en: 'Answered' },
  stat_accuracy: { de: 'Trefferquote', en: 'Accuracy' },
  stat_streak: { de: 'Serie', en: 'Streak' },
  streak_days: { de: '{n} Tage', en: '{n} days' },
  streak_day: { de: '1 Tag', en: '1 day' },

  load_error: { de: 'Verlauf konnte nicht geladen werden.', en: 'History could not be loaded.' },
  retry: { de: 'Erneut versuchen', en: 'Try again' },
  empty_title: { de: 'Noch keine gespeicherte Simulation.', en: 'No saved simulation yet.' },
  empty_body: { de: 'Prüfungen vor dem 20. September 2026 wurden nicht gespeichert.', en: 'Exams before 20 September 2026 were not saved.' }, // date-ok: history ledger start, not an exam sitting
  start_simulation: { de: 'Simulation starten', en: 'Start a simulation' },
  load_more: { de: 'Weitere Prüfungen laden', en: 'Load more exams' },
  loading_more: { de: 'Wird geladen', en: 'Loading' },

  group_full: { de: 'Vollsimulation', en: 'Full simulation' },
  group_part: { de: 'Teilprüfung', en: 'Part exam' },
  group_custom: { de: 'Eigene', en: 'Custom' },
  group_kaf: { de: 'KAF', en: 'KAF' },
  group_simulations: { de: 'Simulationen', en: 'Simulations' },

  chip_over: { de: 'Über 60 Prozent', en: 'Above 60 percent' },
  chip_under: { de: 'Unter 60 Prozent', en: 'Below 60 percent' },
  row_correct: { de: '{correct} von {total} richtig', en: '{correct} of {total} correct' },
  row_duration: { de: 'Dauer {d}', en: 'Duration {d}' },
  bar_label: { de: '{pct} erreicht, Marke bei 60 Prozent', en: '{pct} reached, mark at 60 percent' },
  row_open: { de: 'Auswertung öffnen', en: 'Open review' },

  summary_note: { de: 'Die Auswertung Frage für Frage ist Teil von Pro. Ihre Ergebnisse bleiben gespeichert.', en: 'The question by question review is part of Pro. Your results stay saved.' },
  to_pro: { de: 'Zu Pro', en: 'Go to Pro' },
  wall_title_free: { de: 'Die Auswertung Frage für Frage ist Teil von Pro.', en: 'The question by question review is part of Pro.' },
  wall_title_lapsed: { de: 'Ihr Pro-Zugang ist abgelaufen. Die Auswertung Frage für Frage ist Teil von Pro.', en: 'Your Pro access has ended. The question by question review is part of Pro.' },
  wall_data_many: { de: '{count} Prüfungen sind gespeichert, zuletzt {pct} Prozent.', en: '{count} exams are saved, latest {pct} percent.' },
  wall_data_one: { de: '1 Prüfung ist gespeichert, zuletzt {pct} Prozent.', en: '1 exam is saved, latest {pct} percent.' },
  wall_kept: { de: 'Ihre Ergebnisse bleiben gespeichert.', en: 'Your results stay saved.' },
  wall_list_link: { de: 'Ergebnisse im Verlauf ansehen', en: 'See your results in History' },

  notfound_title: { de: 'Diese Prüfung wurde nicht gefunden.', en: 'This exam was not found.' },
  notfound_body: { de: 'Der Link ist ungültig oder gehört zu einem anderen Konto.', en: 'The link is invalid or belongs to another account.' },
  back_to_list: { de: 'Zum Verlauf', en: 'Back to History' },
  detail_error: { de: 'Diese Prüfung konnte nicht geladen werden.', en: 'This exam could not be loaded.' },
  detail_counts: { de: '{answered} beantwortet, {open} nicht beantwortet', en: '{answered} answered, {open} not answered' },
  detail_score: { de: '{correct} von {total} richtig, {pct}', en: '{correct} of {total} correct, {pct}' },
  self_marked: { de: 'Selbst bewertet', en: 'Self-marked' },

  filter_label: { de: 'Fragen filtern', en: 'Filter questions' },
  filter_wrong: { de: 'Falsch', en: 'Wrong' },
  filter_open: { de: 'Offen', en: 'Open' },
  filter_flagged: { de: 'Markiert', en: 'Flagged' },
  filter_all: { de: 'Alle', en: 'All' },
  filter_empty: { de: 'Keine Fragen in dieser Auswahl.', en: 'No questions in this selection.' },
  practise_missed: { de: 'Alle falschen im Quiz üben ({n})', en: 'Practise all wrong ones in the quiz ({n})' },

  verdict_correct: { de: 'Richtig', en: 'Correct' },
  verdict_wrong: { de: 'Falsch', en: 'Wrong' },
  verdict_open: { de: 'Nicht beantwortet', en: 'Not answered' },
  verdict_removed: { de: 'Aus dem Fragenpool entfernt', en: 'Removed from the bank' },
  subject_other: { de: 'Sonstige', en: 'Other' },
  question_number: { de: 'Frage {n}', en: 'Question {n}' },
  your_answers: { de: 'Ihre Antworten', en: 'Your answers' },
  no_answer: { de: 'Keine Antwort', en: 'No answer' },
  accepted_answer: { de: 'Akzeptierte Antwort', en: 'Accepted answer' },
  explanation: { de: 'Erklärung', en: 'Explanation' },
  practise_one: { de: 'Diese Frage üben', en: 'Practise this question' },
  image_alt: { de: 'Abbildung zu Frage {n}', en: 'Image for question {n}' },
  page_status: { de: 'Seite {page} von {pages}', en: 'Page {page} of {pages}' },
  page_prev: { de: 'Vorherige Seite', en: 'Previous page' },
  page_next: { de: 'Nächste Seite', en: 'Next page' },

  trend_title: { de: 'Entwicklung: {group}', en: 'Trend: {group}' },
  trend_alt: { de: 'Ergebnisse der letzten {n} vergleichbaren Läufe: {list}.', en: 'Results of the last {n} comparable runs: {list}.' },
  trend_delta_up: { de: '{delta} Prozentpunkte mehr als beim vorherigen Lauf.', en: '{delta} percentage points more than the previous run.' },
  trend_delta_down: { de: '{delta} Prozentpunkte weniger als beim vorherigen Lauf.', en: '{delta} percentage points fewer than the previous run.' },
  trend_delta_same: { de: 'Gleich wie beim vorherigen Lauf.', en: 'The same as the previous run.' },
  trend_reference: { de: 'Gestrichelte Linie: 60 Prozent', en: 'Dashed line: 60 percent' },

  qh_exam_type: { de: 'Prüfungsart', en: 'Exam type' },
  qh_all_exams: { de: 'Alle Prüfungen', en: 'All exams' },
  qh_result: { de: 'Ergebnis', en: 'Result' },
  qh_all: { de: 'Alle', en: 'All' },
  qh_period: { de: 'Zeitraum', en: 'Period' },
  qh_any_time: { de: 'Jederzeit', en: 'Any time' },
  qh_last7: { de: 'Letzte 7 Tage', en: 'Last 7 days' },
  qh_last30: { de: 'Letzte 30 Tage', en: 'Last 30 days' },
  qh_count: { de: '{n} Einträge', en: '{n} entries' },
  qh_none: { de: 'Keine Einträge für diese Filter.', en: 'Nothing matches these filters.' },
  qh_error: { de: 'Fragen-Verlauf konnte nicht geladen werden.', en: 'Question history could not be loaded.' },
  qh_your_answer: { de: 'Ihre Antwort:', en: 'Your answer:' },
  qh_correct_label: { de: 'Richtig:', en: 'Correct:' },
  qh_practise_again: { de: 'Nochmal üben', en: 'Practise again' },
  qh_not_in_bank: { de: 'Frage nicht mehr im Fragenpool.', en: 'Question no longer in the bank.' },
  qh_seconds: { de: '{n} s', en: '{n} s' },
  qh_load_more: { de: 'Mehr laden', en: 'Load more' },
} as const;

export type HistoryKey = keyof typeof STRINGS;
export type HistoryVars = Record<string, string | number>;

/** Exposed for the copy guard test; never mutate. */
export const HISTORY_STRINGS: Readonly<Record<HistoryKey, { readonly de: string; readonly en: string }>> = STRINGS;

function isUi(value: unknown): value is UiLanguage {
  return value === 'de' || value === 'en' || value === 'ru' || value === 'uk' || value === 'tr' || value === 'ar';
}

/** The rendered chrome language for a stored preference: de or en. */
export function historyLang(lang: string | null | undefined): 'de' | 'en' {
  return isUi(lang) ? renderLang(lang) : 'en';
}

/** Number locale for the rendered language (de-AT, UX-GLOBAL-03). */
export function historyLocale(lang: string | null | undefined): string {
  return historyLang(lang) === 'de' ? 'de-AT' : 'en-IE';
}

export function th(key: HistoryKey, lang: string | null | undefined, vars?: HistoryVars): string {
  const entry = STRINGS[key] as { de: string; en: string } | undefined;
  if (!entry) return '';
  const rendered = historyLang(lang);
  let text: string = entry[rendered] || entry.en || entry.de;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}
