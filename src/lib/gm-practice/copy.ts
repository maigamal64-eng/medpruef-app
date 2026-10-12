/**
 * Learner copy for Gerichtsmedizin practice (a44). Own dictionary, so the
 * shared i18n.ts stays untouched.
 *
 * de and en are authored; every other account language reads English until a
 * native review exists (Arabic additionally needs [name]'s sign-off). German in
 * formal Sie, no em or en dashes. The questions are MedPrüf-authored practice
 * questions, never real exam questions, and no official oral format is
 * claimed: Vienna's format is not published (GM_FACTS gm.wien), the oral
 * description comes from two candidate accounts and is labelled as such.
 */
import type { Lang } from "@/lib/i18n";

export type GmLang = "de" | "en";
const GM_LANGS: readonly GmLang[] = ["de", "en"];
/** de or en; every other account language reads English until reviewed. */
export const gmLang = (lang: Lang | string): GmLang => GM_LANGS.find((l) => l === lang) ?? "en";

const DE = {
  title: "Gerichtsmedizin: mündliche Übung",
  intro: "Sie sehen eine Frage ohne Antwortoptionen, antworten laut und ohne Vorbereitungszeit und vergleichen danach mit der Musterantwort. Ein Durchgang dauert 10 Minuten.",
  bankNote: "Die Fragen sind von MedPrüf verfasste Übungsfragen zu Rechtsmedizin und Medizinrecht in Österreich, jede zweimal gegen ihre zitierte Quelle geprüft. Es sind keine echten Prüfungsfragen.",
  formatTitle: "Was über das Prüfungsformat bekannt ist",
  reportedTitle: "Berichte aus Wien",
  reportedText: "Zwei Kandidatinnen und Kandidaten aus Wien beschrieben im Mai und Juni 2025 eine kurze mündliche Prüfung von etwa 5 bis 15 Minuten ohne Vorbereitungszeit. Das ist nicht amtlich und kann sich ändern; die Übung bildet kein amtliches Format nach.",
  reportedBasis: "Quelle: Erfahrungsberichte aus einer Lerngruppe, gelesen am",
  scoreNote: "Ihre Selbsteinschätzung bleibt auf diesem Gerät. Sie zählt nicht zu Ihrem Fortschritt, Ihrem Kontingent oder Ihren Wiederholungen.",
  start: "Durchgang starten",
  starting: "Wird gestartet",
  resumeTitle: "Ein Durchgang läuft noch",
  resume: "Fortsetzen",
  mcq: "Als Multiple Choice üben",
  mcqNote: "Multiple Choice läuft in der Fragenbank Pharmakologie / Rezeptierkunde. Ist bei Ihnen eine andere Prüfung aktiv, fragt die Übung zuerst, ob Sie wechseln möchten.",
  backToPage: "Zur Seite Gerichtsmedizin",
  loading: "Fragen werden geladen",
  loadError: "Die Fragen konnten nicht geladen werden.",
  retry: "Erneut versuchen",
  unavailableTitle: "Die Gerichtsmedizin-Übung ist noch nicht verfügbar.",
  unavailableBody: "Sobald die geprüften Fragen freigeschaltet sind, finden Sie die Übung hier.",
  proTitle: "Gerichtsmedizin ist Teil von Pro.",
  proBody: "Mit Pro üben Sie die Gerichtsmedizin-Fragen als Multiple Choice und in der mündlichen Übung.",
  proCta: "Pläne ansehen",
  clock: "Verbleibende Zeit",
  progress: "Frage {n}",
  answerAloud: "Antworten Sie laut. Zeigen Sie danach die Musterantwort.",
  readAloud: "Vorlesen",
  stopReading: "Vorlesen beenden",
  reveal: "Musterantwort zeigen",
  modelAnswer: "Musterantwort",
  explanation: "Erklärung",
  source: "Quelle",
  scorePrompt: "Wie gut war Ihre Antwort?",
  known: "Gewusst",
  partial: "Teilweise",
  unknown: "Nicht gewusst",
  end: "Durchgang beenden",
  timeNotice: "Noch {n} Minuten.",
  summaryTitle: "Durchgang beendet",
  timeUp: "Die 10 Minuten sind um.",
  allDone: "Sie haben alle Fragen dieses Durchgangs beantwortet.",
  summaryCounts: "{known} gewusst, {partial} teilweise, {unknown} nicht gewusst",
  noneScored: "In diesem Durchgang wurde keine Antwort bewertet.",
  reviewTitle: "Zum Wiederholen",
  again: "Neuer Durchgang",
  pageTitle: "Gerichtsmedizin üben",
  pageBody: "Von MedPrüf verfasste Übungsfragen zu Rechtsmedizin und Medizinrecht in Österreich, jede zweimal gegen ihre zitierte Quelle geprüft.",
  pageDrill: "Mündliche Übung starten",
  pageMcq: "Als Multiple Choice üben",
  pagePro: "Die Gerichtsmedizin-Fragen sind Teil von Pro.",
};

const EN: typeof DE = {
  title: "Forensic medicine: oral practice",
  intro: "You see a question without answer options, answer aloud with no preparation time, then compare with the model answer. A run lasts 10 minutes.",
  bankNote: "The questions are practice questions written by MedPrüf on forensic medicine and medical law in Austria, each checked twice against its cited source. They are not real exam questions.",
  formatTitle: "What is known about the exam format",
  reportedTitle: "Reports from Vienna",
  reportedText: "Two candidates from Vienna described a short oral exam of about 5 to 15 minutes with no preparation time in May and June 2025. This is not official and may change; this practice does not reproduce an official format.",
  reportedBasis: "Source: accounts shared in a study group, read on",
  scoreNote: "Your self-assessment stays on this device. It does not count towards your progress, your allowance or your reviews.",
  start: "Start a run",
  starting: "Starting",
  resumeTitle: "A run is still open",
  resume: "Continue",
  mcq: "Practise as multiple choice",
  mcqNote: "Multiple choice runs in the Pharmacology / Rezeptierkunde bank. If another exam is active for you, the practice asks first whether you want to switch.",
  backToPage: "Back to the forensic medicine page",
  loading: "Loading questions",
  loadError: "The questions could not be loaded.",
  retry: "Try again",
  unavailableTitle: "Forensic medicine practice is not available yet.",
  unavailableBody: "As soon as the reviewed questions are switched on, you will find the practice here.",
  proTitle: "Forensic medicine is part of Pro.",
  proBody: "With Pro you practise the forensic medicine questions as multiple choice and in the oral practice.",
  proCta: "See plans",
  clock: "Time left",
  progress: "Question {n}",
  answerAloud: "Answer aloud. Then show the model answer.",
  readAloud: "Read aloud",
  stopReading: "Stop reading",
  reveal: "Show model answer",
  modelAnswer: "Model answer",
  explanation: "Explanation",
  source: "Source",
  scorePrompt: "How good was your answer?",
  known: "Knew it",
  partial: "Partly",
  unknown: "Did not know",
  end: "End run",
  timeNotice: "{n} minutes left.",
  summaryTitle: "Run finished",
  timeUp: "The 10 minutes are up.",
  allDone: "You answered every question in this run.",
  summaryCounts: "{known} knew it, {partial} partly, {unknown} did not know",
  noneScored: "No answer was scored in this run.",
  reviewTitle: "To look at again",
  again: "New run",
  pageTitle: "Practise forensic medicine",
  pageBody: "Practice questions written by MedPrüf on forensic medicine and medical law in Austria, each checked twice against its cited source.",
  pageDrill: "Start oral practice",
  pageMcq: "Practise as multiple choice",
  pagePro: "The forensic medicine questions are part of Pro.",
};

export type GmCopy = typeof DE;
const COPY: Record<GmLang, GmCopy> = { de: DE, en: EN };
export function gmCopy(lang: Lang | string): GmCopy {
  return COPY[gmLang(lang)];
}
/** Date the two candidate accounts were read (archive sweep 2026-10-09). */
export const GM_REPORTS_READ_ON = "2026-10-09";

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
