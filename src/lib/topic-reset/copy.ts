/**
 * a-topic-reset-selfserve-1019 learner copy (DE Sie, EN; other languages render
 * English). Lektor 19 Oct (see track-b handover a-topic-reset-selfserve-1019/lektor.md).
 */
export type ResetLang = "de" | "en";

export interface TopicResetCopy {
  entry: string;
  title: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  body: string;
  kept: string;
  saved: string;
  freeNote: string;
  confirm: string;
  cancel: string;
  busy: string;
  done: (topic: string) => string;
  empty: string;
  rateLimited: string;
  failed: string;
  unconfirmed: string;
  noneYet: string;
}

export const TOPIC_RESET_COPY: Record<ResetLang, TopicResetCopy> = {
  de: {
    entry: "Fortschritt in einem Fach zurücksetzen",
    title: "Fortschritt in einem Fach zurücksetzen",
    subjectLabel: "Fach",
    subjectPlaceholder: "Fach auswählen",
    body: "Ihre Antworten, Ihre Trefferquote, Ihre Fehler, Ihre Wiederholungen und Ihre Karteikarten-Bewertungen in diesem Fach beginnen wieder bei null.",
    kept: "Das bleibt erhalten: Ihre XP, Ihre Serie, Ihr Lernplan, Ihre Lesezeichen und alle anderen Fächer.",
    saved: "Ihr bisheriger Fortschritt wird gesichert. Wenn Sie ihn zurückhaben möchten, schreiben Sie uns über Feedback und Hilfe.",
    freeNote: "Kostenlose Fragen, die Sie schon beantwortet haben, zählen weiter zu Ihren kostenlosen Fragen.",
    confirm: "Fortschritt in diesem Fach zurücksetzen",
    cancel: "Abbrechen",
    busy: "Wird zurückgesetzt",
    done: (topic) => `Der Fortschritt in ${topic} wurde zurückgesetzt.`,
    empty: "In diesem Fach gibt es keinen Fortschritt zum Zurücksetzen.",
    rateLimited: "Sie haben in den letzten 24 Stunden schon 10-mal zurückgesetzt. Bitte versuchen Sie es später wieder.",
    failed: "Das hat nicht geklappt. Ihr Fortschritt ist unverändert. Bitte versuchen Sie es erneut.",
    unconfirmed: "Wir konnten nicht bestätigen, ob der Fortschritt zurückgesetzt wurde. Bitte prüfen Sie das Fach, bevor Sie es erneut versuchen.",
    noneYet: "Sobald Sie in einem Fach Fragen beantwortet haben, können Sie es hier zurücksetzen.",
  },
  en: {
    entry: "Reset progress in a subject",
    title: "Reset progress in a subject",
    subjectLabel: "Subject",
    subjectPlaceholder: "Choose a subject",
    body: "Your answers, hit rate, mistakes, reviews and flashcard ratings in this subject start again from zero.",
    kept: "What stays: your XP, your streak, your study plan, your bookmarks and every other subject.",
    saved: "Your previous progress is saved. If you want it back, write to us through Feedback and help.",
    freeNote: "Free questions you have already answered still count toward your free questions.",
    confirm: "Reset progress in this subject",
    cancel: "Cancel",
    busy: "Resetting",
    done: (topic) => `Progress in ${topic} has been reset.`,
    empty: "There is no progress to reset in this subject.",
    rateLimited: "You have already reset 10 times in the last 24 hours. Please try again later.",
    failed: "That did not work. Your progress is unchanged. Please try again.",
    unconfirmed: "We could not confirm whether the progress was reset. Please check the subject before you try again.",
    noneYet: "Once you have answered questions in a subject, you can reset it here.",
  },
};

export function topicResetCopy(lang: string): TopicResetCopy {
  return TOPIC_RESET_COPY[lang as ResetLang] ?? TOPIC_RESET_COPY.en;
}
