/**
 * Copy of the round-end feedback ask (a-feedback-at-pause, 2026-10-17).
 * Lektor gate: reports/track-b-2026-10-11/handover/a-feedback-at-pause/lektor.md.
 * de and en are authored; every other language reads English until a native
 * review exists. German uses Sie. Lektor 17 Oct: 7 APPROVE, 2 EDIT (applied). No em dashes, no exclamation marks.
 */

export interface FeedbackAskCopy {
  /** Accessible name of the block. */
  region: string;
  question: string;
  hint: string;
  send: string;
  sending: string;
  skip: string;
  thanks: string;
  failed: string;
  tooShort: string;
}

const DE: FeedbackAskCopy = {
  region: "Kurze Frage",
  question: "Eine kurze Frage zum Schluss: Was würde Ihnen beim Lernen mit MedPrüf am meisten helfen?",
  hint: "Freiwillig. Wir lesen jede Antwort.",
  send: "Antwort senden",
  sending: "Wird gesendet…",
  skip: "Überspringen",
  thanks: "Danke für Ihre Antwort.",
  failed: "Ihre Antwort wurde nicht gesendet. Bitte versuchen Sie es erneut.",
  tooShort: "Bitte schreiben Sie mindestens 3 Zeichen.",
};

const EN: FeedbackAskCopy = {
  region: "Short question",
  question: "One short question to finish: what would help you most when studying with MedPrüf?",
  hint: "Optional. We read every answer.",
  send: "Send answer",
  sending: "Sending…",
  skip: "Skip",
  thanks: "Thank you for your answer.",
  failed: "Your answer was not sent. Please try again.",
  tooShort: "Please write at least 3 characters.",
};

export const FEEDBACK_ASK_COPY = { de: DE, en: EN } as const;

export function feedbackAskCopy(lang: string): FeedbackAskCopy {
  return lang === "de" ? DE : EN;
}
