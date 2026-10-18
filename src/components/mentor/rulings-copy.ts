/**
 * Learner strings of the 17 Oct CEO rulings (a-mentor-fix-rulings), client side.
 * DE (Sie) and EN through Lektor; every other UI language shows English (no
 * unreviewed translation). Shown only when the server sets the matching final
 * field, which needs MENTOR_RULINGS_NOTICES. No em dashes.
 */
import type { MentorUiLang } from "@/lib/i18n-mentor";

const COPY = {
  practice_pointer: { de: "Fragen nach Fachgebiet üben", en: "Practise questions by subject" },
} as const;

export type RulingsCopyKey = keyof typeof COPY;

export function rulingsCopy(key: RulingsCopyKey, lang: MentorUiLang): string {
  return (COPY[key] as Readonly<Record<string, string>>)[lang] ?? COPY[key].en;
}
