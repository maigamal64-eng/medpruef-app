import type { MentorUiLang } from "@/lib/i18n-mentor";
/** Conservative script cues only. Ambiguous Cyrillic defaults to RU; no automatic language change. */
export function typedLanguage(text: string): MentorUiLang | null {
  if (/[\u0600-\u06ff]/u.test(text)) return "ar";
  if (/[іїєґІЇЄҐ]/u.test(text)) return "uk";
  if (/[\u0400-\u04ff]/u.test(text)) return "ru";
  if (/[ğışĞİŞ]/u.test(text)) return "tr";
  if (/\b(?:wie|wann|warum|prüfung|anmeldung|lernen|zuerst)\b|[äöüß]/iu.test(text)) return "de";
  if (/\b(?:when|how|why|exam|registration|study|please|what)\b/iu.test(text)) return "en";
  return null;
}
export const LANGUAGE_SWITCH_COPY = {
 de: "Du schreibst auf Deutsch. Soll ich auch auf Deutsch antworten?",
 en: "You're writing in English. Shall I answer in English too?",
 ru: "Ты пишешь по-русски. Отвечать тоже по-русски?",
 uk: "Ти пишеш українською. Відповідати теж українською?",
 tr: "Türkçe yazıyorsun. Türkçe de yanıtlayayım mı?",
} as const;
/** Draft only, needs [name] sign-off. Never displayed. */
export const AR_LANGUAGE_SWITCH_DRAFT = "إنت بتكتب بالعربي. الإجابة بالعربي هتيجي بعدين، هجاوبك بالإنجليزي.";
