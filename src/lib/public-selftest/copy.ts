/**
 * a-public-selftest copy (DE Sie, EN). Lektor APPROVE WITH EDITS (15 Oct, edits applied):
 * track-b handover a-public-selftest/lektor/verdict.md. Rules: curated practice questions, never
 * official or real ones; no pass, readiness or exam-format promise; the timer
 * is our practice pace, not an official duration; Austrian framing; no
 * dashes of the long kind, no exclamation marks; "kostenlose Probe" / "free
 * sample", never a bare "kostenlos", "free" or "gratis".
 */
export type SelftestLang = "de" | "en";

/** German for "de", English for every other language (unreviewed languages fall back to English). */
export function selftestLang(lang: string | null | undefined): SelftestLang {
  return lang === "de" || lang === "en" ? lang : "en";
}

const COPY = {
  meta_title: { de: "Selbsttest ohne Konto: Übungsfragen auf Zeit | MedPrüf", en: "Self-check without an account: timed practice questions | MedPrüf" },
  meta_description: {
    de: "Zehn kuratierte Übungsfragen zum Stichprobentest oder zu SIP4a / SIP5a Wien, auf Zeit und ohne Konto. Ergebnis nach Fachgebiet, keine Aussage über das Bestehen.",
    en: "Ten curated practice questions for the Stichprobentest or SIP4a / SIP5a Vienna, timed and without an account. Result by subject area, no statement about passing.",
  },
  home: { de: "MedPrüf", en: "MedPrüf" },
  language: { de: "Sprache", en: "Language" },
  eyebrow: { de: "Selbsttest ohne Konto", en: "Self-check without an account" },
  title: { de: "{n} Übungsfragen auf Zeit", en: "{n} timed practice questions" },
  intro: {
    de: "Ohne Konto und ohne Karte. Wählen Sie Ihre Prüfung, beantworten Sie {n} kuratierte Übungsfragen in {minutes} Minuten und sehen Sie Ihr Ergebnis nach Fachgebiet.",
    en: "No account and no card. Choose your exam, answer {n} curated practice questions in {minutes} minutes and see your result by subject area.",
  },
  scope: {
    de: "Es sind kuratierte Übungsfragen, keine offiziellen Prüfungsfragen. Das Ergebnis sagt nichts darüber, ob Sie bestehen oder bereit für die Prüfung sind. Das Zeitlimit ist unser Übungstempo von 1,5 Minuten pro Frage, keine offizielle Angabe.",
    en: "These are curated practice questions, not official exam questions. The result says nothing about whether you will pass or are ready for the exam. The time limit is our practice pace of 1.5 minutes per question, not an official figure.",
  },
  bank_label: { de: "Für welche Prüfung möchten Sie üben?", en: "Which exam do you want to practise for?" },
  start: { de: "Selbsttest starten", en: "Start the self-check" },
  loading: { de: "Fragen werden geladen", en: "Loading questions" },
  error_title: { de: "Der Selbsttest ist gerade nicht erreichbar", en: "The self-check is not available right now" },
  error_body: { de: "Bitte versuchen Sie es in einer Minute erneut.", en: "Please try again in a minute." },
  retry: { de: "Erneut versuchen", en: "Try again" },
  progress: { de: "Frage {i} von {n}", en: "Question {i} of {n}" },
  // Screen-reader labels of the question map (added after the Lektor pass; plain labels, no claims).
  map_label: { de: "Fragenübersicht", en: "Question overview" },
  map_item_answered: { de: "Frage {i} von {n}, beantwortet", en: "Question {i} of {n}, answered" },
  map_item_open: { de: "Frage {i} von {n}, noch nicht beantwortet", en: "Question {i} of {n}, not answered yet" },
  time_left: { de: "Verbleibende Zeit: {time}", en: "Time left: {time}" },
  field: { de: "Fachgebiet: {field}", en: "Subject area: {field}" },
  multi_hint: { de: "Mehrere Antworten sind richtig. Wählen Sie {n}.", en: "Several answers are correct. Choose {n}." },
  single_hint: { de: "Eine Antwort ist richtig.", en: "One answer is correct." },
  back: { de: "Zurück", en: "Back" },
  next: { de: "Weiter", en: "Next" },
  finish: { de: "Auswerten", en: "See my result" },
  finish_open: { de: "Unbeantwortete Fragen: {k}. Jede zählt als nicht gelöst.", en: "Unanswered questions: {k}. Each counts as not solved." },
  finish_confirm: { de: "Trotzdem auswerten", en: "See my result anyway" },
  keep_going: { de: "Weiter beantworten", en: "Keep answering" },
  timeout: { de: "Die Zeit ist abgelaufen. Offene Fragen zählen als nicht gelöst.", en: "Time is up. Open questions count as not solved." },
  result_label: { de: "Ihr Ergebnis", en: "Your result" },
  result_value: { de: "{c} von {n} richtig", en: "{c} of {n} correct" },
  result_status: { de: "Kuratierte Übung auf Zeit", en: "Curated timed practice" },
  result_note: {
    de: "Eine Frage zählt nur, wenn alle richtigen und keine falschen Antworten gewählt sind. Das ist unsere Übungsregel, die offizielle Bewertung kann davon abweichen. Keine Aussage über das Bestehen oder die Prüfungsreife.",
    en: "A question counts only when every correct answer and no wrong one is chosen. This is our practice rule; official scoring may differ. No statement about passing or exam readiness.",
  },
  fields_title: { de: "Nach Fachgebiet", en: "By subject area" },
  field_line: { de: "{c} von {n} richtig", en: "{c} of {n} correct" },
  review_title: { de: "Ihre Antworten", en: "Your answers" },
  review_show: { de: "Antworten ansehen", en: "Show my answers" },
  review_hide: { de: "Antworten ausblenden", en: "Hide my answers" },
  review_open: { de: "Nicht beantwortet", en: "Not answered" },
  sitting_title: { de: "Für welchen Termin lernen Sie?", en: "Which sitting are you studying for?" },
  sitting_hint: {
    de: "Es stehen nur offizielle Termine zur Wahl. Bitte bestätigen Sie Termin und Anmeldefrist bei der Universität, an der Sie Ihren Antrag eingereicht haben.",
    en: "Only official sittings are listed. Please confirm the date and registration deadline with the university where you filed your application.",
  },
  sitting_open: { de: "Noch offen", en: "Not decided yet" },
  sitting_open_note: { de: "Sie können den Termin später in den Einstellungen festlegen.", en: "You can set the sitting later in Settings." },
  save_title: { de: "Ergebnis und Plan speichern", en: "Save your result and plan" },
  save_body_named: {
    de: "Mit einem Konto speichern wir Ihre Antworten und Ihren Termin. Daraus entsteht Ihr Lernplan bis zu diesem Termin.",
    en: "With an account we save your answers and your sitting. Your study plan to that sitting is built from them.",
  },
  save_body_open: {
    de: "Mit einem Konto speichern wir Ihre Antworten, und Sie üben mit der kostenlosen Probe weiter. Den Termin können Sie später festlegen.",
    en: "With an account we save your answers and you continue with the free sample. You can set your sitting later.",
  },
  save_cta: { de: "Ergebnis und Plan speichern", en: "Save result and plan" },
  save_cta_signed_in: { de: "In mein Konto übernehmen", en: "Add to my account" },
  save_saving: { de: "Wird gespeichert", en: "Saving" },
  save_terms: { de: "Kostenlose Probe, ohne Karte.", en: "Free sample, no card." },
  restart: { de: "Neu starten", en: "Start again" },
  login_line: { de: "Nach der Registrierung oder Anmeldung übernehmen wir Ihr Ergebnis aus dem Selbsttest in Ihr Konto, dazu Ihren Termin, falls Sie einen gewählt haben.", en: "After you sign up or sign in, we add your self-check result to your account, with your sitting if you chose one." },
  entry_link: { de: "Selbsttest ohne Konto: 10 Übungsfragen auf Zeit", en: "Self-check without an account: 10 timed practice questions" },
  entry_hint: { de: "Ergebnis nach Fachgebiet, keine Registrierung nötig.", en: "Result by subject area, no sign-up needed." },
} as const satisfies Record<string, Record<SelftestLang, string>>;

export type SelftestCopyKey = keyof typeof COPY;

export function selftestCopy(key: SelftestCopyKey, lang: SelftestLang, vars: Record<string, string | number> = {}): string {
  return COPY[key][lang].replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Every copy string, for the guard test and the Lektor packet. */
export function allSelftestCopy(): { key: string; lang: SelftestLang; text: string }[] {
  return Object.entries(COPY).flatMap(([key, v]) => (["de", "en"] as const).map((lang) => ({ key, lang, text: v[lang] })));
}

/** Display names of the stored topics the allowlist uses (a test keeps every allowlisted topic covered). */
export const FIELD_LABELS: Record<string, Record<SelftestLang, string>> = {
  "Innere Medizin": { de: "Innere Medizin", en: "Internal medicine" },
  "Notfall- und Intensivmedizin": { de: "Notfall- und Intensivmedizin", en: "Emergency and intensive care medicine" },
  "Chirurgische Fächer": { de: "Chirurgische Fächer", en: "Surgical subjects" },
  "Kinder- und Jugendheilkunde": { de: "Kinder- und Jugendheilkunde", en: "Paediatrics" },
  "Kinder Und Jugendheilkunde": { de: "Kinder- und Jugendheilkunde", en: "Paediatrics" },
  "Neurologie": { de: "Neurologie", en: "Neurology" },
  "Chirurgische Spezialfächer Und Anästhesie": { de: "Chirurgische Spezialfächer und Anästhesie", en: "Surgical specialties and anaesthesia" },
  "Dermatologie und Venerologie": { de: "Dermatologie und Venerologie", en: "Dermatology and venereology" },
  "Augenheilkunde": { de: "Augenheilkunde", en: "Ophthalmology" },
};

export function fieldLabel(topic: string, lang: SelftestLang): string {
  return FIELD_LABELS[topic]?.[lang] ?? topic;
}
