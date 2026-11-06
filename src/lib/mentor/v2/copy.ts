/**
 * Mentor v2 code-owned learner lines (a-mentor-better-1106). DE (Sie), EN and Egyptian Arabic
 * (auto-approved under [name]'s 29 Oct ruling; the Review Desk can veto); ru, uk, tr and fr fall
 * back to English like the other Mentor chips. No em dashes, no exclamation marks, no digits.
 */

import type { MentorLang } from "../contract";

type V2Key = "deeper_chip" | "deeper_message" | "start_simulation" | "from_bank";

const COPY: Readonly<Record<"de" | "en" | "ar", Readonly<Record<V2Key, string>>>> = Object.freeze({
  de: {
    deeper_chip: "Ausführlicher erklären",
    deeper_message: "Bitte erklären Sie das ausführlicher.",
    start_simulation: "Simulation starten",
    from_bank: "Aus Übungsfragen der MedPrüf-Fragenbank",
  },
  en: {
    deeper_chip: "Explain in more depth",
    deeper_message: "Please explain this in more depth.",
    start_simulation: "Start a simulation",
    from_bank: "From practice questions in the MedPrüf question bank",
  },
  ar: {
    deeper_chip: "اشرحلي بالتفصيل",
    deeper_message: "ممكن تشرحلي ده بالتفصيل؟",
    start_simulation: "ابدأ امتحان تجريبي",
    from_bank: "من أسئلة التدريب في بنك أسئلة MedPrüf",
  },
});

export function v2Copy(key: V2Key, lang: MentorLang | string | null | undefined): string {
  const l = lang === "de" || lang === "ar" ? lang : "en";
  return COPY[l][key];
}
