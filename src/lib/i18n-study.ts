/**
 * Study plan and progress chrome strings (a25, LX-01..04, LX-09, CNT-42,
 * INF-04, UX-STU-07/16..29/35..40). German in Sie, English in American
 * spelling; every unreviewed language renders English (REVIEWED_LANGS = de,
 * en; UX-STU-63). No em dashes, no pass prediction, no shame framing.
 *
 * ts(key, lang, vars?) never returns a raw key.
 */
import { renderLang, type UiLanguage } from './language-model';

const STRINGS = {
  // Page chrome
  plan_title: { de: 'Lernplan', en: 'Study plan' },
  plan_signin_body: { de: 'Bitte loggen Sie sich ein, um Ihren Lernplan bis zur Prüfung zu sehen.', en: 'Please log in to see your study plan up to exam day.' },
  plan_signin: { de: 'Einloggen', en: 'Log in' },

  // Hero (UX-STU-18, LX-01, LX-03)
  hero_days: { de: 'Noch {n} Tage bis zur Prüfung', en: 'Your exam is in {n} days' },
  hero_day: { de: 'Noch 1 Tag bis zur Prüfung', en: 'Your exam is in 1 day' },
  hero_today: { de: 'Heute ist Ihr Prüfungstag', en: 'Your exam is today' },
  hero_days_provisional: { de: 'Noch {n} Tage bis zum nächsten Termin', en: '{n} days until the next sitting' },
  hero_day_provisional: { de: 'Noch 1 Tag bis zum nächsten Termin', en: '1 day until the next sitting' },
  hero_horizon: { de: 'Plan für die nächsten {n} Tage', en: 'Plan for the next {n} days' },
  hero_unit_days: { de: 'Tage', en: 'days' },
  hero_unit_day: { de: 'Tag', en: 'day' },
  hero_target_official: { de: 'Nächster offizieller Termin: {date}', en: 'Next official sitting: {date}' },
  hero_target_horizon: { de: 'Für diese Prüfung ist noch kein Termin veröffentlicht. Der Plan reicht 12 Wochen.', en: 'No sitting is published for this exam yet. The plan covers 12 weeks.' },
  hero_change_date: { de: 'Prüfungstermin ändern', en: 'Change exam date' },
  hero_set_date: { de: 'Prüfungstermin eintragen', en: 'Enter your exam date' },
  hero_split: { de: '70 % der Zeit: neuer Stoff, 30 % der Zeit: Wiederholung ab {date}', en: '70% of the time: new material, 30% of the time: review from {date}' },
  hero_short: { de: 'Wenig Zeit bis zur Prüfung: Der Plan wiederholt jetzt Ihre schwächeren Fachgebiete.', en: 'Not much time left: the plan now reviews your weaker topics.' },
  hero_far: { de: 'Der Plan zeigt das nächste Jahr. Er wächst mit, wenn der Termin näher rückt.', en: 'The plan shows the next year. It extends as the date gets closer.' },

  // Expired own date (LX-03)
  expired_title: { de: 'Ihr Termin ist vorbei.', en: 'Your exam date has passed.' },
  expired_next: { de: 'Nächster Termin: {date}', en: 'Next sitting: {date}' },
  expired_switch: { de: 'Plan auf diesen Termin umstellen', en: 'Switch the plan to this date' },
  expired_other: { de: 'Anderen Termin wählen', en: 'Choose another date' },
  expired_none: { de: 'Für diese Prüfung ist noch kein neuer Termin veröffentlicht. Der Plan reicht vorerst 12 Wochen.', en: 'No new sitting is published for this exam yet. For now the plan covers 12 weeks.' },
  switch_saving: { de: 'Wird gespeichert', en: 'Saving' },
  switch_error: { de: 'Der Termin konnte nicht gespeichert werden. Bitte versuchen Sie es noch einmal.', en: 'The date could not be saved. Please try again.' },
  switch_done: { de: 'Termin gespeichert', en: 'Date saved' },

  // Provisional (LX-01, pick-plan-target A)
  provisional_badge: { de: 'Vorläufig', en: 'Provisional' },
  provisional_body: { de: 'Dieser Plan zielt auf den nächsten offiziellen Termin. Er gilt, bis Sie Ihren eigenen Termin wählen.', en: 'This plan targets the next official sitting. It applies until you choose your own date.' },
  provisional_later: { de: 'Termin später eintragen', en: 'Enter my date later' },

  // Effort (LX-02, UX-STU-23)
  effort_reach: { de: 'Mit {goal} Fragen am Tag kommen Sie bis zum {date} auf etwa {reach} neue Fragen. In Ihrer Prüfung sind {unseen} noch offen. Dazu kommt die Wiederholung Ihrer Fehler.', en: 'At {goal} questions a day you reach about {reach} new questions by {date}. {unseen} in your exam are still open. Review of your mistakes comes on top.' },
  effort_fits: { de: 'Das passt: Für alle offenen Fragen reichen etwa {q} Fragen am Tag (rund {m} Minuten).', en: 'That works: about {q} questions a day (around {m} minutes) cover every open question.' },
  effort_tight: { de: 'Das wird knapp: Für alle offenen Fragen wären es etwa {q} Fragen am Tag (rund {m} Minuten).', en: 'That is tight: covering every open question takes about {q} questions a day (around {m} minutes).' },
  effort_too_much: { de: 'Für alle offenen Fragen wären es etwa {q} Fragen am Tag (rund {m} Minuten). Das ist sehr viel. Sie können den Plan auf Ihre schwächeren Fachgebiete eingrenzen.', en: 'Covering every open question takes about {q} questions a day (around {m} minutes). That is a lot. You can narrow the plan to your weaker topics.' },
  effort_none_open: { de: 'Sie haben jede Frage Ihrer Prüfung mindestens einmal gesehen. Der Plan wiederholt jetzt.', en: 'You have seen every question in your exam at least once. The plan now reviews.' },
  effort_basis: { de: 'Grundlage: etwa 1,5 Minuten je Frage (Schätzung).', en: 'Basis: about 1.5 minutes per question (estimate).' },
  effort_share: { de: 'Für 80 % der Fragen wären es etwa {q} am Tag.', en: 'For 80% of the questions it would be about {q} a day.' },
  goal_label: { de: 'Fragen pro Tag', en: 'Questions per day' },
  goal_saving: { de: 'Tagesziel wird gespeichert', en: 'Saving daily goal' },
  goal_error: { de: 'Das Tagesziel konnte nicht gespeichert werden.', en: 'The daily goal could not be saved.' },
  focus_weak_on: { de: 'Auf schwächere Fachgebiete eingrenzen', en: 'Narrow to weaker topics' },
  focus_weak_off: { de: 'Alle Fachgebiete planen', en: 'Plan all topics' },
  focus_weak_active: { de: 'Der Plan umfasst nur Ihre schwächeren Fachgebiete.', en: 'The plan covers your weaker topics only.' },

  // Registration line and phases (UX-STU-24 B, UX-STU-18)
  reg_line_days: { de: 'Anmeldeschluss: {date}, noch {n} Tage', en: 'Registration closes: {date}, {n} days left' },
  reg_line_day: { de: 'Anmeldeschluss: {date}, noch 1 Tag', en: 'Registration closes: {date}, 1 day left' },
  reg_passed: { de: 'Die Anmeldefrist für diesen Termin ist vorbei ({date}).', en: 'Registration for this sitting has closed ({date}).' },
  reg_source: { de: 'Quelle', en: 'Source' },
  reg_two_publishers: { de: 'Die Fristen werden unterschiedlich angegeben. Bitte prüfen Sie Ihre Frist bei der Universität, an der Sie eingereicht haben.', en: 'The deadlines are published differently. Please check yours with the university where you filed.' },
  reg_per_muw: { de: 'laut MedUni Wien Merkblatt (Einreichung)', en: 'per the MedUni Wien Merkblatt (filing)' },
  reg_per_imed: { de: 'laut i-med (Anmeldung)', en: 'per i-med (registration)' },
  phases_title: { de: 'Phasen bis zur Prüfung', en: 'Phases until the exam' },
  phase_new: { de: 'Neuer Stoff', en: 'New material' },
  phase_review: { de: 'Wiederholung', en: 'Review' },
  phase_exam: { de: 'Prüfung', en: 'Exam' },
  phase_range: { de: '{from} bis {to}', en: '{from} to {to}' },
  phase_until_date: { de: 'bis {to}', en: 'until {to}' },
  phase_now: { de: 'jetzt', en: 'now' },
  phase_strip: { de: 'Neuer Stoff bis {date}, dann Wiederholung', en: 'New material until {date}, then review' },
  phase_strip_review: { de: 'Wiederholung bis zur Prüfung', en: 'Review until the exam' },

  // Today (UX-STU-19, 20, 26)
  today_title: { de: 'Heute dran', en: 'Today' },
  today_total: { de: '{done} von {goal} heute', en: '{done} of {goal} today' },
  today_total_unknown: { de: 'Ziel heute: {goal} Fragen', en: 'Goal today: {goal} questions' },
  today_to_goal: { de: 'Noch {n} Fragen bis zum Tagesziel', en: '{n} questions to today’s goal' },
  today_goal_done: { de: 'Tagesziel erreicht', en: 'Daily goal reached' },
  today_rest: { de: 'Heute ist ein freier Tag. Üben können Sie trotzdem jederzeit.', en: 'Today is a free day. You can still practice any time.' },
  today_light: { de: 'Leichter Tag: halbe Menge, nur Wiederholung.', en: 'Light day: half the load, review only.' },
  block_questions: { de: '{n} Fragen', en: '{n} questions' },
  block_question: { de: '1 Frage', en: '1 question' },
  block_aria: { de: '{topic}, {focus}, {count}: üben', en: '{topic}, {focus}, {count}: practice' },
  focus_new: { de: 'Neu', en: 'New' },
  focus_weak: { de: 'Mehr üben', en: 'Practice more' },
  focus_review: { de: 'Wiederholung', en: 'Review' },
  plan_adapts: { de: 'Der Plan passt sich täglich an Ihren Stand an.', en: 'The plan adapts daily to your progress.' },

  // Simulation days (LX-04, UX-STU-25)
  sim_label: { de: 'Prüfungssimulation', en: 'Exam simulation' },
  sim_detail: { de: '{n} Fragen, {h} Stunden, mit Zeitlimit', en: '{n} questions, {h} hours, timed' },
  sim_detail_min: { de: '{n} Fragen, {m} Minuten, mit Zeitlimit', en: '{n} questions, {m} minutes, timed' },

  // Upcoming days (UX-STU-27)
  upcoming_title: { de: 'Kommende Tage', en: 'Upcoming days' },
  upcoming_more: { de: '{first} und {n} weitere', en: '{first} and {n} more' },
  upcoming_more_one: { de: '{first} und 1 weiteres', en: '{first} and 1 more' },
  upcoming_free: { de: 'Freier Tag', en: 'Free day' },
  upcoming_light: { de: 'Leichter Tag', en: 'Light day' },
  upcoming_empty: { de: 'Keine weiteren geplanten Tage.', en: 'No further planned days.' },
  upcoming_practice_now: { de: 'Heute schon üben', en: 'Practice it today' },

  // Weak subjects (UX-STU-21, 35)
  weak_title: { de: 'Schwächere Fachgebiete', en: 'Weaker topics' },
  weak_body: { de: 'Diese Fachgebiete bekommen im Plan mehr Gewicht.', en: 'These topics get more weight in your plan.' },

  // Quiz return (UX-STU-20)
  back_plan: { de: 'Zurück zum Lernplan', en: 'Back to study plan' },
  back_progress: { de: 'Zurück zum Fortschritt', en: 'Back to progress' },
  back_curriculum: { de: 'Zurück zum Lehrplan', en: 'Back to curriculum' },
  back_library: { de: 'Zurück zur Bibliothek', en: 'Back to Library' },
  back_mistakes: { de: 'Zurück zu den Fehlern', en: 'Back to mistakes' },
  back_history: { de: 'Zurück zum Verlauf', en: 'Back to history' },

  // Progress page (LX-09, UX-STU-29/35/36/38/40)
  progress_title: { de: 'Fortschritt', en: 'Progress' },
  progress_coverage_error: { de: 'Der Fortschritt für diese Prüfung konnte nicht geladen werden.', en: 'Progress for this exam could not be loaded.' },
  progress_empty_title: { de: 'Noch nicht genug Daten', en: 'Not enough data yet' },
  progress_empty_body: { de: 'Sobald Sie ein paar Fragen beantwortet haben, erscheinen hier Ihr Wissensprofil und Ihre Wochen.', en: 'Once you answer a few questions, your knowledge profile and weeks show up here.' },
  progress_empty_cta: { de: 'Erste Fragen beantworten', en: 'Answer your first questions' },
  progress_countdown_set: { de: 'Prüfungstermin festlegen', en: 'Set exam date' },
  weekly_title: { de: 'Wochen im Überblick', en: 'Weeks at a glance' },
  weekly_volume: { de: 'Antworten je Woche', en: 'Answers per week' },
  weekly_accuracy: { de: 'Trefferquote je Woche', en: 'Accuracy per week' },
  weekly_alt: { de: 'Letzte {n} Wochen: {list}', en: 'Last {n} weeks: {list}' },
  weekly_week: { de: 'Woche ab {date}: {answered} Antworten, Trefferquote {acc}', en: 'Week of {date}: {answered} answers, accuracy {acc}' },
  weekly_none: { de: 'keine Antworten', en: 'no answers' },
  weekly_empty: { de: 'Sobald Sie Fragen beantworten, sehen Sie hier Ihre Wochen.', en: 'Once you answer questions, your weeks appear here.' },
  weekly_error: { de: 'Die Wochenübersicht konnte nicht geladen werden.', en: 'The weekly overview could not be loaded.' },
  weekly_retry: { de: 'Erneut versuchen', en: 'Try again' },
  weekly_values: { de: 'Werte als Liste', en: 'Values as a list' },
  weekly_basis: { de: 'Alle Antworten in Ihrer aktiven Prüfung, mit Wiederholungen.', en: 'All answers in your active exam, including repeats.' },
  next_title: { de: 'Ihr nächster Schritt', en: 'Your next step' },
  next_weakest: { de: 'Schwächstes Fachgebiet üben: {topic}', en: 'Practice your weakest topic: {topic}' },
  next_weakest_pro: { de: 'Fehler in {topic} wiederholen', en: 'Review mistakes in {topic}' },
  next_weak_list: { de: 'Fachgebiete unter 60 % Trefferquote (ab {min} Antworten), schwächstes zuerst', en: 'Topics under 60% accuracy (from {min} answers), weakest first' },
  next_weak_stat: { de: '{acc} richtig, {n} Antworten', en: '{acc} correct, {n} answers' },
  kpi_seen: { de: 'Verschiedene Fragen gesehen', en: 'Different questions seen' },
  kpi_seen_sub: { de: 'ohne Wiederholungen', en: 'without repeats' },
  kpi_seen_of: { de: '{n} von {total}', en: '{n} of {total}' },
  kpi_answers: { de: 'Antworten insgesamt', en: 'Total answers' },
  kpi_answers_sub: { de: 'mit Wiederholungen', en: 'with repeats' },
  kpi_accuracy: { de: 'Trefferquote', en: 'Accuracy' },
  kpi_accuracy_sub: { de: '{c} von {n} richtig', en: '{c} of {n} correct' },
  kpi_streak: { de: 'Serie', en: 'Streak' },
  kpi_days: { de: 'Tage', en: 'days' },
  kpi_day: { de: 'Tag', en: 'day' },
  kpi_unknown: { de: 'unbekannt', en: 'unknown' },
  saved_title: { de: 'Gemerkt', en: 'Saved' },
  saved_questions: { de: 'Gemerkte Fragen', en: 'Saved questions' },
  saved_notes: { de: 'Notizen zur Frage', en: 'Notes on questions' },
  saved_empty: { de: 'Noch nichts gemerkt. Gemerkte Fragen und Lernnotizen finden Sie in der Bibliothek.', en: 'Nothing saved yet. Saved questions and study notes are in the Library.' },
  saved_library: { de: 'Zur Bibliothek', en: 'Open Library' },
  radar_more: { de: 'Beantworten Sie Fragen in mindestens drei Fachgebieten, dann erscheint das Wissensprofil.', en: 'Answer questions in at least three topics to see the knowledge profile.' },
  radar_title: { de: 'Wissensprofil', en: 'Knowledge profile' },
  radar_subjects: { de: '{n} Fachgebiete', en: '{n} topics' },
  radar_list_title: { de: 'Trefferquote je Fachgebiet', en: 'Accuracy by topic' },
  radar_alt: { de: 'Wissensprofil als Netzdiagramm. Die Werte stehen in der Liste darunter.', en: 'Knowledge profile as a radar chart. The values are in the list below.' },

  // Field readiness (CNT-42)
  fields_title: { de: 'Stand je Fachgebiet', en: 'Status by topic' },
  fields_intro: { de: 'Zum Vergleich die Regel aus der offiziellen Quelle:', en: 'For comparison, the rule from the official source:' },
  fields_stp_note: { de: 'Die Fachgebiete hier sind die Themen unserer Fragenbank, nicht genau die zehn offiziellen Prüfungsfächer.', en: 'The topics here come from our question bank, not exactly the ten official exam fields.' },
  fields_rule_link: { de: 'Regel und Quelle ansehen', en: 'See the rule and its source' },
  fields_basis: { de: 'Grundlage: Ihre Antworten im Üben, nur Fachgebiete mit mindestens {min} Antworten. Das ist keine Vorhersage Ihres Ergebnisses.', en: 'Basis: your practice answers, only topics with at least {min} answers. This is not a prediction of your result.' },
  fields_at: { de: 'ab 60 %', en: '60% or more' },
  fields_below: { de: 'unter 60 %', en: 'under 60%' },
  fields_few: { de: 'zu wenig Antworten', en: 'not enough answers' },
  fields_row: { de: '{field}: {acc} richtig bei {n} Antworten, {state}', en: '{field}: {acc} correct over {n} answers, {state}' },
  fields_row_few: { de: '{field}: {n} Antworten, zu wenig für eine Aussage', en: '{field}: {n} answers, not enough to tell' },
  fields_all_at: { de: 'Alle Fachgebiete mit genug Antworten liegen bei 60 % oder mehr.', en: 'Every topic with enough answers is at 60% or more.' },
  fields_some_below: { de: '{n} von {total} Fachgebieten liegen noch unter 60 % oder haben zu wenige Antworten.', en: '{n} of {total} topics are still under 60% or have too few answers.' },
  fields_error: { de: 'Der Stand je Fachgebiet konnte nicht geladen werden.', en: 'The status by topic could not be loaded.' },
  starter_title: { de: 'So bereiten Sie sich vor', en: 'How to prepare' },
  starter_order: { de: 'Reihenfolge: zuerst jedes Fachgebiet einmal ansehen, dann die schwächsten Fachgebiete üben, in den letzten Wochen Prüfungssimulationen mit Zeitlimit.', en: 'Order: first look at every topic once, then practice the weakest, and in the last weeks take timed exam simulations.' },
  starter_enough: { de: 'Genug geübt ist ein Fachgebiet, wenn Sie dort im Üben stabil 60 % oder mehr erreichen. Das ist eine Orientierung, keine Prognose.', en: 'A topic is practiced enough when you reach 60% or more there steadily. This is guidance, not a forecast.' },

  // Mock exam trend (INF-04)
  sims_title: { de: 'Prüfungssimulationen je Fachgebiet', en: 'Exam simulations by topic' },
  sims_count: { de: '{n} Vollsimulationen abgeschlossen', en: '{n} full-length simulations completed' },
  sims_count_one: { de: '1 Vollsimulation abgeschlossen', en: '1 full-length simulation completed' },
  sims_need_three: { de: 'Nach drei Vollsimulationen sehen Sie hier die Entwicklung je Fachgebiet.', en: 'After three full-length simulations you see the trend per topic here.' },
  sims_not_prediction: { de: 'Das ist keine Vorhersage Ihres Ergebnisses.', en: 'This is not a prediction of your result.' },
  sims_gap_over: { de: '{n} Prozentpunkte über 60 %', en: '{n} percentage points over 60%' },
  sims_gap_under: { de: '{n} Prozentpunkte unter 60 %', en: '{n} percentage points under 60%' },
  sims_gap_at: { de: 'genau 60 %', en: 'exactly 60%' },
  sims_delta_up: { de: '{n} Prozentpunkte mehr als zuvor', en: '{n} percentage points more than before' },
  sims_delta_down: { de: '{n} Prozentpunkte weniger als zuvor', en: '{n} percentage points less than before' },
  sims_delta_same: { de: 'gleich wie zuvor', en: 'same as before' },
  sims_few: { de: 'zu wenige Fragen für einen Vergleich', en: 'too few questions to compare' },
  sims_error: { de: 'Die Prüfungssimulationen konnten nicht geladen werden.', en: 'Exam simulations could not be loaded.' },
} as const;

export type StudyKey = keyof typeof STRINGS;
export type StudyVars = Record<string, string | number>;

/** Exposed for the copy guard test; never mutate. */
export const STUDY_STRINGS: Readonly<Record<StudyKey, { readonly de: string; readonly en: string }>> = STRINGS;

function isUi(value: unknown): value is UiLanguage {
  return value === 'de' || value === 'en' || value === 'ru' || value === 'uk' || value === 'tr' || value === 'ar';
}

/** Rendered chrome language for a stored preference: de or en. */
export function studyLang(lang: string | null | undefined): 'de' | 'en' {
  return isUi(lang) ? renderLang(lang) : 'en';
}

/** Number and date locale for the rendered language. */
export function studyLocale(lang: string | null | undefined): string {
  return studyLang(lang) === 'de' ? 'de-AT' : 'en-GB';
}

export function ts(key: StudyKey, lang: string | null | undefined, vars?: StudyVars): string {
  const entry = STRINGS[key] as { de: string; en: string } | undefined;
  if (!entry) return '';
  let text: string = entry[studyLang(lang)] || entry.en || entry.de;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}

/** "13. November 2026" / "November 13, 2026" from an ISO day, timezone-safe. */
export function studyDate(iso: string, lang: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString(studyLocale(lang), { ...opts, timeZone: 'UTC' });
}

/** Grouped integer ("4.885" / "4,885"). */
export function studyNumber(n: number, lang: string | null | undefined): string {
  return Math.round(n).toLocaleString(studyLocale(lang));
}

/** "42 %" / "42%". */
export function studyPct(n: number, lang: string | null | undefined): string {
  const v = Math.round(n);
  return studyLang(lang) === 'de' ? `${v} %` : `${v}%`;
}
