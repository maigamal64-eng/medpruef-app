/**
 * CEO rulings of 17 Oct 2026 (a-mentor-fix-rulings; reports/hq/decisions.json
 * mentor-uc13-free-form, mentor-arabic-notice, mentor-eval-leads-1017).
 *
 * Code-owned learner lines only: the model never writes them, the validator
 * never sees them, and none changes whether a turn is charged (a refusal is
 * the house's anyway; the Arabic notice is added after the charge decision).
 * Shown only while MENTOR_RULINGS_NOTICES is on (MentorConfig.rulingsNotices).
 *
 * Copy: DE (Sie) and EN through Lektor. Every other answer language gets the
 * English line (no unreviewed translation). The Arabic notice is English only;
 * an Egyptian Arabic line waits for [name]'s sign-off (journey section 8).
 * No digits in any line (the answer validator and the eval graders count them).
 */

import type { MentorLang } from "./contract";

/** Where a medical concept refusal points: the question bank by subject (the explain entry sits on answered /quiz questions). */
export const PRACTICE_POINTER_HREF = "/curriculum";

/** UC13: replaces the office line on a free-form medical concept refusal (reason stays no_verified_source). */
export const CONCEPT_REFUSAL_LINES: Readonly<Record<"de" | "en", string>> = Object.freeze({
  de: "Medizinische Fachfragen ohne Übungsfrage beantworte ich nicht. Üben Sie das Thema in der Fragenbank: Nach einer beantworteten Übungsfrage erkläre ich Ihnen die Antwort anhand dieser Frage.",
  en: "I do not answer medical questions without a practice question. Practise the topic in the question bank: after you answer a practice question, I explain the answer from that question.",
});

export function conceptRefusalLine(lang: MentorLang | null | undefined): string {
  return (CONCEPT_REFUSAL_LINES as Readonly<Record<string, string>>)[lang ?? "en"] ?? CONCEPT_REFUSAL_LINES.en;
}

/** mentor-arabic-notice: the first line of every Mentor reply to a learner who writes in Arabic (English only). */
export const ARABIC_NOTICE_EN = "The Mentor answers in English, not in Arabic. Here is the answer in English.";

const ARABIC_LETTER_RE = /(?=\p{L})\p{Script=Arabic}/gu;
const ANY_LETTER_RE = /\p{L}/gu;

/** Share of letters in Arabic script (0 when the text has no letters). */
export function arabicLetterShare(text: string): number {
  if (typeof text !== "string") return 0;
  const letters = text.match(ANY_LETTER_RE)?.length ?? 0;
  if (letters === 0) return 0;
  return (text.match(ARABIC_LETTER_RE)?.length ?? 0) / letters;
}

/**
 * The learner writes in Arabic and the reply is English: the request asks for
 * Arabic (answered in English, pick-arabic A) or asks for English while at
 * least half of the message's letters are Arabic script. A German or other
 * answer language is the learner's own choice and gets no notice.
 */
export function writesArabic(lang: MentorLang | null | undefined, message: string): boolean {
  if (lang === "ar") return true;
  return lang === "en" && arabicLetterShare(message) >= 0.5;
}
