/**
 * Learner copy for the timed KAF practice mode (a24, SIM-04 / CNT-14). Own
 * dictionary so the shared src/lib/i18n.ts stays untouched.
 *
 * de and en are authored. Every other account language reads English until a
 * native review exists (Arabic additionally needs [name]'s sign-off). German
 * uses formal Sie. No em or en dashes; tests/unit/a24-kaf/copy.test.ts
 * enforces both rules. The copy never presents items as original exam
 * questions: they are practice items from the MedPrüf bank.
 */

import type { Lang } from "@/lib/i18n";

export interface KafCopy {
  title: string;
  intro: string;
  bankNote: string;
  countLabel: string;
  countOption: string;
  clock: string;
  scopeNote: string;
  ruleSource: string;
  poolCount: string;
  start: string;
  starting: string;
  resumeTitle: string;
  resumeBody: string;
  resume: string;
  discard: string;
  discardTitle: string;
  discardBody: string;
  pendingTitle: string;
  pendingAction: string;
  unavailableTitle: string;
  unavailableBody: string;
  backToExam: string;
  loadError: string;
  retry: string;
  proTitle: string;
  proBody: string;
  proCta: string;
  loading: string;
  leave: string;
  leaveTitle: string;
  leaveBody: string;
  stay: string;
  questionOf: string;
  answerSingle: string;
  answerN: string;
  requiredHint: string;
  prev: string;
  next: string;
  overview: string;
  answeredOf: string;
  goToQuestion: string;
  answeredState: string;
  openState: string;
  submit: string;
  submitTitle: string;
  submitBody: string;
  cancel: string;
  timeLeft: string;
  timeNotice: string;
  timeUp: string;
  autosaveFailed: string;
  offline: string;
  imageAlt: string;
  markingTitle: string;
  markingIntro: string;
  yourAnswer: string;
  noAnswer: string;
  modelAnswer: string;
  keyPoints: string;
  alsoAccepted: string;
  keyMissing: string;
  suggestMatches: string;
  suggestCompare: string;
  suggestEmpty: string;
  markRight: string;
  markWrong: string;
  markedCount: string;
  finish: string;
  finishNeedAll: string;
  keysLoading: string;
  keysError: string;
  resultHeading: string;
  resultLabel: string;
  resultValue: string;
  practiceLabel: string;
  resultNote: string;
  answeredLine: string;
  timeoutLine: string;
  saving: string;
  saved: string;
  saveFailed: string;
  saveRejected: string;
  retrySave: string;
  discardResult: string;
  authExpired: string;
  signIn: string;
  newRun: string;
  toHistory: string;
  historyTitle: string;
  itemRight: string;
  itemNotRight: string;
}

const DE: KafCopy = {
  title: "KAF-Übung: Kurzantwortfragen",
  intro: "Sie schreiben kurze Antworten selbst, ohne Auswahloptionen. Nach dem Abgeben vergleichen Sie jede Antwort mit der Musterantwort und bewerten sich selbst.",
  bankNote: "Übungsfragen aus der MedPrüf-Fragenbank, keine Originalfragen der Prüfung.",
  countLabel: "Anzahl der Fragen",
  countOption: "{n} Fragen",
  clock: "Übungszeit 240 Minuten, offizielle Dauer nicht bestätigt",
  scopeNote: "Die Musterantworten wurden von zwei medizinischen Prüfungen bestätigt. In der echten Prüfung bewerten Fachleute; hier bewerten Sie sich selbst.",
  ruleSource: "Quelle: {label}",
  poolCount: "{n} geprüfte Fragen verfügbar",
  start: "Übung starten",
  starting: "Fragen werden geladen",
  resumeTitle: "Sie haben eine KAF-Übung begonnen.",
  resumeBody: "{a} von {n} Fragen beantwortet. Die Übungszeit läuft weiter.",
  resume: "Fortsetzen",
  discard: "Verwerfen",
  discardTitle: "Übung verwerfen?",
  discardBody: "Ihre Antworten dieser Übung werden auf diesem Gerät gelöscht.",
  pendingTitle: "Ein KAF-Ergebnis ist noch nicht gespeichert.",
  pendingAction: "Ergebnis öffnen",
  unavailableTitle: "Die KAF-Übung ist derzeit nicht verfügbar.",
  unavailableBody: "Bitte versuchen Sie es später erneut. Die Prüfungssimulation mit Auswahlfragen steht Ihnen weiterhin offen.",
  backToExam: "Zur Prüfungssimulation",
  loadError: "Die Fragen konnten nicht geladen werden.",
  retry: "Erneut versuchen",
  proTitle: "Die KAF-Übung ist Teil von Pro.",
  proBody: "Mit Pro üben Sie Kurzantwortfragen auf Zeit und vergleichen Ihre Antworten mit geprüften Musterantworten.",
  proCta: "Pläne ansehen",
  loading: "Wird geladen",
  leave: "Verlassen",
  leaveTitle: "Übung verlassen?",
  leaveBody: "Ihre Antworten bleiben auf diesem Gerät gespeichert. Die Übungszeit läuft weiter.",
  stay: "Weiter üben",
  questionOf: "Frage {i} von {n}",
  answerSingle: "Ihre Antwort",
  answerN: "Antwort {i}",
  requiredHint: "Gesucht sind {n} Antworten.",
  prev: "Zurück",
  next: "Weiter",
  overview: "Übersicht",
  answeredOf: "{a} von {n} beantwortet",
  goToQuestion: "Frage {i}, {state}",
  answeredState: "beantwortet",
  openState: "offen",
  submit: "Abgeben",
  submitTitle: "Übung abgeben?",
  submitBody: "{a} von {n} Fragen beantwortet. Nach dem Abgeben können Sie Ihre Antworten nicht mehr ändern.",
  cancel: "Abbrechen",
  timeLeft: "Verbleibende Übungszeit",
  timeNotice: "Noch {n} Minuten Übungszeit.",
  timeUp: "Die Übungszeit ist abgelaufen. Ihre Antworten wurden abgegeben.",
  autosaveFailed: "Ihre Antworten können auf diesem Gerät nicht gespeichert werden. Bitte lassen Sie diese Seite geöffnet.",
  offline: "Sie sind offline. Ihre Antworten werden auf diesem Gerät gespeichert.",
  imageAlt: "Abbildung zur Frage",
  markingTitle: "Selbst bewerten",
  markingIntro: "Vergleichen Sie Ihre Antwort mit der Musterantwort. Ein Punkt zählt nur bei vollständig richtiger Antwort. Schreibfehler zählen nur, wenn sie die Bedeutung ändern. Sie entscheiden; der Hinweis ist nur eine Hilfe.",
  yourAnswer: "Ihre Antwort",
  noAnswer: "Keine Antwort",
  modelAnswer: "Musterantwort",
  keyPoints: "Kernpunkte",
  alsoAccepted: "Ebenfalls akzeptierte Formulierungen",
  keyMissing: "Für diese Frage ist keine Musterantwort mehr verfügbar.",
  suggestMatches: "Hinweis: Ihre Antwort stimmt mit einer gespeicherten Formulierung überein. Prüfen Sie, ob sie vollständig ist.",
  suggestCompare: "Hinweis: Keine wörtliche Übereinstimmung. Vergleichen Sie den Inhalt selbst.",
  suggestEmpty: "Ohne Antwort zählt die Frage als nicht richtig.",
  markRight: "Richtig",
  markWrong: "Nicht richtig",
  markedCount: "{d} von {n} beantworteten Fragen bewertet",
  finish: "Ergebnis anzeigen",
  finishNeedAll: "Bitte bewerten Sie zuerst alle beantworteten Fragen.",
  keysLoading: "Musterantworten werden geladen",
  keysError: "Die Musterantworten konnten nicht geladen werden. Ihre Antworten bleiben gespeichert.",
  resultHeading: "Ihr Ergebnis",
  resultLabel: "Ergebnis",
  resultValue: "{r} von {n} richtig",
  practiceLabel: "Übung, selbst bewertet",
  resultNote: "In der echten Prüfung bewerten Fachleute Ihre Antworten.",
  answeredLine: "{a} von {n} Fragen beantwortet",
  timeoutLine: "Die Übungszeit war abgelaufen.",
  saving: "Wird gespeichert",
  saved: "Im Verlauf gespeichert",
  saveFailed: "Noch nicht gespeichert. Wir versuchen es automatisch erneut.",
  saveRejected: "Dieses Ergebnis kann nicht im Verlauf gespeichert werden.",
  retrySave: "Erneut speichern",
  discardResult: "Ergebnis verwerfen",
  authExpired: "Bitte melden Sie sich erneut an, damit das Ergebnis gespeichert wird.",
  signIn: "Anmelden",
  newRun: "Neue KAF-Übung",
  toHistory: "Zum Verlauf",
  historyTitle: "KAF-Übung",
  itemRight: "Als richtig bewertet",
  itemNotRight: "Als nicht richtig bewertet",
};

const EN: KafCopy = {
  title: "KAF practice: short-answer questions",
  intro: "You write short answers yourself, without choices. After you submit, you compare each answer with the model answer and mark it yourself.",
  bankNote: "Practice items from the MedPrüf question bank, not original exam questions.",
  countLabel: "Number of questions",
  countOption: "{n} questions",
  clock: "Practice time 240 minutes, official duration not confirmed",
  scopeNote: "The model answers were confirmed by two medical reviews. In the real exam, subject experts grade; here you mark yourself.",
  ruleSource: "Source: {label}",
  poolCount: "{n} reviewed questions available",
  start: "Start practice",
  starting: "Loading questions",
  resumeTitle: "You have started a KAF practice run.",
  resumeBody: "{a} of {n} questions answered. The practice clock keeps running.",
  resume: "Resume",
  discard: "Discard",
  discardTitle: "Discard this run?",
  discardBody: "Your answers for this run are deleted from this device.",
  pendingTitle: "A KAF result has not been saved yet.",
  pendingAction: "Open result",
  unavailableTitle: "KAF practice is not available right now.",
  unavailableBody: "Please try again later. The multiple-choice exam simulation is still open to you.",
  backToExam: "To the exam simulation",
  loadError: "The questions could not be loaded.",
  retry: "Try again",
  proTitle: "KAF practice is part of Pro.",
  proBody: "With Pro you practise timed short-answer questions and compare your answers with reviewed model answers.",
  proCta: "See plans",
  loading: "Loading",
  leave: "Leave",
  leaveTitle: "Leave this run?",
  leaveBody: "Your answers stay saved on this device. The practice clock keeps running.",
  stay: "Keep practising",
  questionOf: "Question {i} of {n}",
  answerSingle: "Your answer",
  answerN: "Answer {i}",
  requiredHint: "{n} answers are asked for.",
  prev: "Back",
  next: "Next",
  overview: "Overview",
  answeredOf: "{a} of {n} answered",
  goToQuestion: "Question {i}, {state}",
  answeredState: "answered",
  openState: "open",
  submit: "Submit",
  submitTitle: "Submit this run?",
  submitBody: "{a} of {n} questions answered. After you submit, you can no longer change your answers.",
  cancel: "Cancel",
  timeLeft: "Practice time left",
  timeNotice: "{n} minutes of practice time left.",
  timeUp: "Practice time is up. Your answers were submitted.",
  autosaveFailed: "Your answers cannot be saved on this device. Please keep this page open.",
  offline: "You are offline. Your answers are saved on this device.",
  imageAlt: "Image for the question",
  markingTitle: "Mark yourself",
  markingIntro: "Compare your answer with the model answer. A point counts only for a fully correct answer. Spelling matters only when it changes the meaning. You decide; the hint is only a help.",
  yourAnswer: "Your answer",
  noAnswer: "No answer",
  modelAnswer: "Model answer",
  keyPoints: "Key points",
  alsoAccepted: "Also accepted wordings",
  keyMissing: "No model answer is available for this question any more.",
  suggestMatches: "Hint: your answer matches a stored wording. Check that it is complete.",
  suggestCompare: "Hint: no word-for-word match. Compare the content yourself.",
  suggestEmpty: "Without an answer, the question counts as not right.",
  markRight: "Right",
  markWrong: "Not right",
  markedCount: "{d} of {n} answered questions marked",
  finish: "Show result",
  finishNeedAll: "Please mark every answered question first.",
  keysLoading: "Loading model answers",
  keysError: "The model answers could not be loaded. Your answers stay saved.",
  resultHeading: "Your result",
  resultLabel: "Result",
  resultValue: "{r} of {n} right",
  practiceLabel: "Practice, self-marked",
  resultNote: "In the real exam, subject experts grade your answers.",
  answeredLine: "{a} of {n} questions answered",
  timeoutLine: "Practice time had run out.",
  saving: "Saving",
  saved: "Saved to history",
  saveFailed: "Not saved yet. We will try again automatically.",
  saveRejected: "This result cannot be saved to your history.",
  retrySave: "Save again",
  discardResult: "Discard result",
  authExpired: "Please sign in again so the result can be saved.",
  signIn: "Sign in",
  newRun: "New KAF practice",
  toHistory: "To history",
  historyTitle: "KAF practice",
  itemRight: "Marked right",
  itemNotRight: "Marked not right",
};

export const KAF_COPY = { de: DE, en: EN } as const;

/** German for German, English for every other language (reviewed fallback). */
export function kafCopy(lang: Lang): KafCopy {
  return lang === "de" ? DE : EN;
}

/** Language for exam-formats.data.json rule text (de or en only). */
export function kafFormatLang(lang: Lang): "de" | "en" {
  return lang === "de" ? "de" : "en";
}

/** Replace {name} placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
