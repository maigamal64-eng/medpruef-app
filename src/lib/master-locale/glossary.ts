/**
 * Product glossary (UX-GLOBAL-05): one word per concept, DE (formal Sie,
 * pick-copy-register A) and EN. Recorded for agents in
 * context/FEATURE-TERMINOLOGY.md. Money words stay owned by billing-copy.ts;
 * this module names them but never states a price.
 *
 * `retired` lists words that must not be used for the concept on new learner
 * strings. tests/unit/master-locale/glossary.test.ts checks the table and that
 * owned learner files do not reintroduce the retired sign-in wording.
 */

export type GlossaryEntry = {
  de: string;
  en: string;
  /** Words that must not stand for this concept in new learner strings. */
  retired: readonly string[];
  note?: string;
};

export const GLOSSARY = {
  sign_in: { de: 'Einloggen', en: 'Log in', retired: ['Anmelden', 'melden Sie sich an'], note: "'Anmeldung' and 'Anmeldeschluss' name exam registration on the same screens." },
  sign_in_sentence: { de: 'Bitte loggen Sie sich ein', en: 'Please log in', retired: ['Bitte melden Sie sich an'] },
  sign_in_pending: { de: 'Wird eingeloggt…', en: 'Logging in…', retired: ['Wird angemeldet'] },
  register_tab: { de: 'Registrieren', en: 'Sign up', retired: [] },
  register_action: { de: 'Konto erstellen', en: 'Create account', retired: [] },
  topic_unit: { de: 'Fachgebiet', en: 'Topic', retired: ['Fach', 'Fächer'] },
  topic_unit_plural: { de: 'Fachgebiete', en: 'Topics', retired: ['Fächer'] },
  timed_mock: { de: 'Prüfungssimulation', en: 'Exam simulation', retired: ['Probeprüfung', 'Prüfungssimulator'] },
  timed_mock_short: { de: 'Simulation', en: 'Simulation', retired: [] },
  exam_noun: { de: 'Prüfung', en: 'Exam', retired: [], note: 'What the learner prepares for and picks.' },
  bank_noun: { de: 'Fragenbank', en: 'Question bank', retired: ['Qbank'], note: 'The content set used in counts, limits and comparisons.' },
  mode_new: { de: 'Neue Fragen', en: 'New questions', retired: [] },
  mode_mistakes: { de: 'Meine Fehler', en: 'My mistakes', retired: [] },
  mode_mistakes_short: { de: 'Fehler', en: 'Mistakes', retired: [] },
  mode_reviews: { de: 'Wiederholungen', en: 'Reviews', retired: [] },
  mode_by_topic: { de: 'Gemischt nach Fachgebiet', en: 'Mixed by topic', retired: [] },
  mode_in_order: { de: 'Der Reihe nach', en: 'In order', retired: [] },
  flashcards: { de: 'Karteikarten', en: 'Flashcards', retired: ['Lernkarte'] },
  study_note: { de: 'Lernnotiz', en: 'Study note', retired: [] },
  save_as_note: { de: 'Als Lernnotiz speichern', en: 'Save as study note', retired: [] },
  saved_question: { de: 'Gemerkte Frage', en: 'Saved question', retired: ['Lesezeichen'] },
  save_question: { de: 'Merken', en: 'Save', retired: [] },
  saved_question_state: { de: 'Gemerkt', en: 'Saved', retired: ['Gespeichert'] },
  question_note: { de: 'Notiz zur Frage', en: 'Note on this question', retired: [] },
  list: { de: 'Liste', en: 'List', retired: [] },
  trial_button: { de: 'Pro 7 Tage testen', en: 'Try Pro for 7 days', retired: ['Gratis-Woche', 'Testwoche', 'Testphase'] },
  trial_noun: { de: 'Pro-Test', en: 'Pro trial', retired: ['Gratis-Woche', 'Testwoche', 'Testphase'] },
  free_sample: { de: 'kostenlose Probe', en: 'free sample', retired: ['gratis', 'Free-Kontingent'], note: 'The name of the 150-question allowance on learner surfaces, never a bare free offer.' },
  free_tier: { de: 'kostenlos', en: 'free', retired: ['gratis', 'Free-Kontingent'], note: "Only after the word Probe or Test ('kostenlose Probe', 'kostenloser Test'), never bare next to a number or a button." },
  paid_name: { de: 'Pro', en: 'Pro', retired: ['Premium'] },
  guarantee_first: { de: 'Pass-Until-You-Pass-Garantie', en: 'Pass-Until-You-Pass guarantee', retired: ['PUYP'] },
  guarantee: { de: 'Garantie', en: 'guarantee', retired: ['PUYP'] },
  account_billing: { de: 'Abo und Zahlung', en: 'Subscription and payment', retired: [] },
  exam_date: { de: 'Prüfungstermin', en: 'Exam date', retired: ['Prüfungsdatum'] },
  set_exam_date: { de: 'Prüfungstermin festlegen', en: 'Set exam date', retired: [] },
  see_plans: { de: 'Tarife ansehen', en: 'See plans', retired: ['Pro ansehen', 'Zu Pro', 'Auf Pro upgraden', 'Pro freischalten'] },
  retry_payment: { de: 'Zahlung erneut starten', en: 'Restart payment', retired: ['Erneut bezahlen'] },
  check_access: { de: 'Zugang prüfen', en: 'Check access', retired: ['Jetzt erneut prüfen'] },
  retry_request: { de: 'Erneut versuchen', en: 'Try again', retired: ['Nochmal versuchen', 'Nochmal?'] },
  reload_page: { de: 'Neu laden', en: 'Reload', retired: [] },
  reload_image: { de: 'Erneut laden', en: 'Load again', retired: [] },
  resend: { de: 'Erneut senden', en: 'Send again', retired: [] },
  skip: { de: 'Überspringen', en: 'Skip', retired: [] },
  undo: { de: 'Rückgängig', en: 'Undo', retired: [] },
  later: { de: 'Später', en: 'Later', retired: [] },
  app_language: { de: 'Sprache der App', en: 'App language', retired: [] },
  questions_stay_german: { de: 'Die Prüfungsfragen sind auf Deutsch.', en: 'Exam questions are in German.', retired: [] },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Glossary word for the rendered language (German for de, English otherwise). */
export function term(key: GlossaryKey, lang: string = 'de'): string {
  return lang === 'de' ? GLOSSARY[key].de : GLOSSARY[key].en;
}

/** "Stufe 3 von 8" / "Level 3 of 8": rank as numbers only, no career names. */
export function rankLabel(level: number, total: number, lang: string = 'de'): string {
  return lang === 'de' ? `Stufe ${level} von ${total}` : `Level ${level} of ${total}`;
}
