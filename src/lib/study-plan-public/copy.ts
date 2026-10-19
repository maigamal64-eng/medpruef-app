/**
 * Copy for the public study-plan page (/lernplan). German in Sie, English
 * alongside; other languages read the English page (guidance rule GU-08).
 * No prices, no pass promise, no eligibility advice, Austrian framing.
 */
export type PublicPlanLang = "de" | "en";

type Vars = Record<string, string | number>;

const COPY = {
  meta_title: { de: "Lernplan bis zum Prüfungstermin | MedPrüf", en: "Study plan to your exam date | MedPrüf" },
  meta_description: {
    de: "Wählen Sie Fragenbank, offiziellen Termin und Stunden pro Woche: MedPrüf verteilt die Übungsfragen Woche für Woche bis zu Ihrer Prüfung in Österreich.",
    en: "Pick a question bank, an official sitting and your hours per week: MedPrüf spreads the practice questions week by week up to your exam in Austria.",
  },
  home: { de: "MedPrüf", en: "MedPrüf" },
  eyebrow: { de: "LERNPLAN FÜR ÖSTERREICH", en: "STUDY PLAN FOR AUSTRIA" },
  title: { de: "Ihr Lernplan bis zum Prüfungstermin", en: "Your study plan to the exam date" },
  intro: {
    de: "Wählen Sie Ihre Fragenbank, einen offiziellen Termin und wie viele Stunden Sie pro Woche lernen können. Sie sehen sofort, wie sich die Übungsfragen auf die Wochen verteilen. Ohne Konto.",
    en: "Choose your question bank, an official sitting and how many hours a week you can study. You see right away how the practice questions spread over the weeks. No account needed.",
  },
  // a-lernplan-conversion-1019: the first action on the page, practice in the visitor's bank.
  practice_title: { de: "Welche Prüfung steht bei Ihnen an?", en: "Which exam is next for you?" },
  practice_body: {
    de: "Tippen Sie auf Ihre Prüfung und üben Sie gleich mit der kostenlosen Auswahl an Übungsfragen.",
    en: "Tap your exam and start right away with the free sample of practice questions.",
  },
  practice_hint_kmp_innsbruck: {
    de: "Ein gemeinsamer Test der drei MedUnis, der Ort wechselt",
    en: "A joint test of the three MedUnis, the venue rotates",
  },
  practice_hint_kenntnispruefung: { de: "Prüfungen SIP4a und SIP5a an der MedUni Wien", en: "SIP4a and SIP5a exams at MedUni Wien" },
  practice_go: { de: "Kostenlose Auswahl üben", en: "Practise the free sample" },
  practice_go_signed_in: { de: "Weiter üben", en: "Keep practising" },
  practice_note: {
    de: "Kostenloses Konto mit Ihrer E-Mail, keine Karte. Danach geht es direkt zur ersten Frage.",
    en: "Free account with your email, no card. Then you go straight to your first question.",
  },
  practice_note_signed_in: { de: "Sie sind angemeldet. Es geht direkt zur nächsten Frage.", en: "You are signed in. You go straight to your next question." },
  plan_section_title: { de: "Oder erstellen Sie zuerst Ihren Lernplan bis zum Termin", en: "Or build your study plan to your sitting first" },
  form_title: { de: "Ihre Angaben", en: "Your details" },
  field_bank: { de: "Fragenbank", en: "Question bank" },
  field_sitting: { de: "Offizieller Termin", en: "Official sitting" },
  field_hours: { de: "Lernzeit pro Woche", en: "Study time per week" },
  hours_option: { de: "{n} Stunden pro Woche", en: "{n} hours a week" },
  sitting_publisher: { de: "Veröffentlicht von: {publishers}", en: "Published by {publishers}" },
  sitting_closed: { de: "{label} (Anmeldung geschlossen)", en: "{label} (registration closed)" },
  sitting_none: {
    de: "Für diese Fragenbank ist derzeit kein kommender Termin offiziell veröffentlicht.",
    en: "No upcoming sitting is officially published for this question bank yet.",
  },
  submit: { de: "Lernplan anzeigen", en: "Show study plan" },
  hours_hint: {
    de: "Wir rechnen mit etwa {min} Minuten pro Frage. Das ist eine Schätzung.",
    en: "We assume about {min} minutes per question. This is an estimate.",
  },
  plan_title: { de: "Ihr Plan bis zum {date}", en: "Your plan to {date}" },
  summary_days: { de: "Noch {days} Tage bis zum Termin", en: "{days} days to the sitting" },
  summary_day: { de: "Noch 1 Tag bis zum Termin", en: "1 day to the sitting" },
  summary_pace: {
    de: "Etwa {perDay} Fragen pro Tag, rund {perWeek} pro Woche",
    en: "About {perDay} questions a day, around {perWeek} a week",
  },
  summary_reach: {
    de: "Bis zum Termin sehen Sie in diesem Tempo etwa {reach} von {total} Fragen der Fragenbank einmal.",
    en: "At this pace you see about {reach} of the bank's {total} questions once before the sitting.",
  },
  summary_all: {
    de: "In diesem Tempo sehen Sie alle {total} Fragen der Fragenbank vor dem Termin mindestens einmal.",
    en: "At this pace you see all {total} questions of the bank at least once before the sitting.",
  },
  verdict_fits: { de: "Das passt gut in die Zeit bis zum Termin.", en: "This fits the time to the sitting well." },
  verdict_tight: {
    de: "Das wird eng. Mehr Stunden pro Woche oder ein späterer Termin geben Ihnen Luft.",
    en: "This is tight. More hours a week or a later sitting give you room.",
  },
  verdict_too_much: {
    de: "Für die ganze Fragenbank reicht die Zeit nicht. Der Plan setzt Schwerpunkte und wiederholt zum Schluss.",
    en: "The time is not enough for the whole bank. The plan sets priorities and reviews at the end.",
  },
  phase_new: { de: "Neue Fragen", en: "New questions" },
  phase_consolidation: { de: "Wiederholung", en: "Review" },
  phase_mixed: { de: "Neue Fragen, dann Wiederholung", en: "New questions, then review" },
  review_from: { de: "Ab {date} wiederholen Sie.", en: "From {date} you review." },
  review_all: { de: "Die ganze Zeit bis zum Termin ist Wiederholung.", en: "The whole time to the sitting is review." },
  weeks_title: { de: "Woche für Woche", en: "Week by week" },
  week_label: { de: "Woche {n}", en: "Week {n}" },
  week_range: { de: "{from} bis {to}", en: "{from} to {to}" },
  week_questions: { de: "{n} Fragen", en: "{n} questions" },
  week_more: { de: "und {n} weitere Fachgebiete", en: "and {n} more subjects" },
  week_more_one: { de: "und 1 weiteres Fachgebiet", en: "and 1 more subject" },
  week_simulation: { de: "Probeprüfung in dieser Woche (Pro)", en: "Mock exam this week (Pro)" },
  week_light: { de: "Ein leichterer Tag zum Wiederholen", en: "One lighter day for review" },
  weeks_show_all: { de: "Alle {n} Wochen anzeigen", en: "Show all {n} weeks" },
  topic_count: { de: "{topic}: {n}", en: "{topic}: {n}" },
  registration_title: { de: "Anmeldung zu diesem Termin", en: "Registration for this sitting" },
  registration_line: { de: "{kind} ({publisher}): {date}", en: "{kind} ({publisher}): {date}" },
  kind_registration: { de: "Anmeldefrist", en: "Registration deadline" },
  kind_filing: { de: "Einreichungsfrist", en: "Filing deadline" },
  closes_at: { de: "{date}, {time} Uhr (Wiener Zeit)", en: "{date}, {time} (Vienna time)" },
  registration_window_future: { de: "{kind} ({publisher}): vom {from} bis {date}", en: "{kind} ({publisher}): from {from} to {date}" },
  kind_window_registration: { de: "Anmeldung", en: "Registration" },
  kind_window_filing: { de: "Einreichung", en: "Filing" },
  registration_passed: { de: "(bereits vorbei)", en: "(already passed)" },
  registration_two: {
    de: "Für den Stichprobentest nennen zwei Stellen eine Frist. Bitte klären Sie mit der Universität, bei der Sie eingereicht haben, welche für Sie gilt.",
    en: "For the Stichprobentest two publishers name a deadline. Please confirm with the university where you filed which one applies to you.",
  },
  registration_other_unconfirmed: {
    de: "Die Frist der anderen veröffentlichenden Stelle ist auf der offiziellen Seite noch nicht eindeutig. Bitte prüfen Sie sie dort.",
    en: "The other publisher's deadline is not yet clear on the official page. Please check it there.",
  },
  registration_unconfirmed: {
    de: "Das Anmeldefenster ist auf der offiziellen Seite noch nicht eindeutig. Bitte prüfen Sie es dort.",
    en: "The registration window is not yet clear on the official page. Please check it there.",
  },
  registration_none: {
    de: "Für diesen Termin ist keine Frist veröffentlicht. Bitte prüfen Sie die offizielle Seite.",
    en: "No deadline is published for this sitting. Please check the official page.",
  },
  source: { de: "Offizielle Quelle", en: "Official source" },
  save_title: { de: "Plan speichern und loslegen", en: "Save the plan and start" },
  save_body: {
    de: "Mit einem kostenlosen Konto speichern wir Termin und Tagesziel. Ihr Lernplan in MedPrüf passt sich dann an Ihre Antworten an.",
    en: "With a free account we save the sitting and your daily goal. Your study plan in MedPrüf then adapts to your answers.",
  },
  save_scope: {
    de: "Das kostenlose Konto enthält eine Auswahl an Fragen jeder Fragenbank. Die ganze Fragenbank, wie im Plan verteilt, ist Teil von Pro.",
    en: "The free account includes a selection of questions from each bank. The whole bank, as spread in this plan, is part of Pro.",
  },
  save_cta: { de: "Kostenloses Konto anlegen und Plan speichern", en: "Create a free account and save the plan" },
  save_cta_signed_in: { de: "In meinen Lernplan übernehmen", en: "Use this in my study plan" },
  save_signed_in_note: {
    de: "Ihr Termin und Ihr Tagesziel in MedPrüf werden durch diese Angaben ersetzt, nachdem Sie bestätigt haben.",
    en: "Your sitting and daily goal in MedPrüf are replaced by these values after you confirm.",
  },
  disclaimer_title: { de: "Gut zu wissen", en: "Good to know" },
  disclaimer_scope: {
    de: "Der Plan verteilt die Übungsfragen der MedPrüf-Fragenbank auf die Wochen bis zum Termin. Er sagt nichts darüber aus, welche Prüfungen Sie ablegen müssen: Das legt Ihr Verfahren bei der Universität fest.",
    en: "The plan spreads the practice questions of the MedPrüf bank over the weeks to the sitting. It does not say which exams you have to take: your procedure at the university decides that.",
  },
  disclaimer_questions: {
    de: "Die Fragen sind kuratierte Übungsfragen, keine offiziellen Prüfungsfragen. Ein Lernplan sagt kein Prüfungsergebnis voraus.",
    en: "The questions are curated practice questions, not official exam questions. A study plan does not predict an exam result.",
  },
  disclaimer_dates: {
    de: "Termine und Fristen stammen von den offiziellen Seiten der Universitäten, gelesen am {date}. Bitte prüfen Sie sie vor der Anmeldung dort.",
    en: "Sittings and deadlines come from the universities' official pages, read on {date}. Please check them there before you register.",
  },
  calendar_link: { de: "Alle offiziellen Termine", en: "All official sittings" },
  error_title: { de: "Der Plan lässt sich gerade nicht berechnen", en: "The plan cannot be calculated right now" },
  error_body: {
    de: "Die Fragenbank ist gerade nicht erreichbar. Bitte versuchen Sie es in einer Minute erneut.",
    en: "The question bank cannot be reached right now. Please try again in a minute.",
  },
  retry: { de: "Erneut versuchen", en: "Try again" },
  language: { de: "Sprache", en: "Language" },
  and: { de: " und ", en: " and " },
} as const;

export type PublicPlanCopyKey = keyof typeof COPY;

export function pc(key: PublicPlanCopyKey, lang: PublicPlanLang, vars?: Vars): string {
  let text: string = COPY[key][lang];
  if (vars) for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
  return text;
}

export const PUBLIC_PLAN_COPY = COPY;
