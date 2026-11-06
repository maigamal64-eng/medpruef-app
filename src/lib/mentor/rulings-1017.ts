/**
 * CEO rulings of 17 Oct 2026 (a-mentor-fix-rulings; reports/hq/decisions.json
 * mentor-uc13-free-form, mentor-arabic-notice, mentor-eval-leads-1017).
 *
 * Code-owned learner lines only: the model never writes them, the validator
 * never sees them, and none changes whether a turn is charged (a refusal is
 * the house's anyway). Shown only while MENTOR_RULINGS_NOTICES is on
 * (MentorConfig.rulingsNotices).
 *
 * Copy: DE (Sie), EN and, since a-ai-fix-1106, Egyptian Arabic (auto-approved
 * under [name]'s 29 Oct ruling). Every other answer language gets the English line.
 * The mentor-arabic-notice ("The Mentor answers in English") is retired: the
 * Mentor answers Arabic in Arabic ([name], 6 Nov).
 * No digits in any line (the answer validator and the eval graders count them).
 */

import type { MentorLang } from "./contract";

/** Where a medical concept refusal points: the question bank by subject (the explain entry sits on answered /quiz questions). */
export const PRACTICE_POINTER_HREF = "/curriculum";

/** UC13: replaces the office line on a free-form medical concept refusal (reason stays no_verified_source). */
export const CONCEPT_REFUSAL_LINES: Readonly<Record<"de" | "en" | "ar", string>> = Object.freeze({
  de: "Medizinische Fachfragen ohne Übungsfrage beantworte ich nicht. Üben Sie das Thema in der Fragenbank: Nach einer beantworteten Übungsfrage erkläre ich Ihnen die Antwort anhand dieser Frage.",
  en: "I do not answer medical questions without a practice question. Practise the topic in the question bank: after you answer a practice question, I explain the answer from that question.",
  ar: "مش بجاوب على أسئلة طبية من غير سؤال تدريب. ذاكر الموضوع في بنك الأسئلة: بعد ما تجاوب على سؤال تدريب، هشرحلك الإجابة من السؤال ده.",
});

export function conceptRefusalLine(lang: MentorLang | null | undefined): string {
  return (CONCEPT_REFUSAL_LINES as Readonly<Record<string, string>>)[lang ?? "en"] ?? CONCEPT_REFUSAL_LINES.en;
}
