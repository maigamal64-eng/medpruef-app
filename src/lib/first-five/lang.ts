/** German for "de", English for every other UI language (these lines have no other translation yet). */
export type DualLang = "de" | "en";

export function dualLang(lang: string): DualLang {
  return lang.startsWith("de") ? "de" : "en";
}
