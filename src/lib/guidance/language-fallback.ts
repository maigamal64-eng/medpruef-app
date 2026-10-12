/**
 * Guidance pages in the learners' languages (a29, GU-08, G34).
 *
 * Guidance facts and page copy exist in German and English. Statements may
 * carry optional ru/uk/tr/ar text (GuidanceStatement); a translation renders
 * only after its native review (REVIEWED_LANGS, Arabic by [name]) and only when
 * every date, time and number equals the German row (guidanceParityIssues).
 * The parity check reads numeric dates only: before statementText gets a
 * caller, translations must write dates as digits or the check must learn
 * month names (a29 reviewer note).
 * Until then a reader with one of those preferences gets the English page
 * with a visible "English version" line, never a silent fallback. Persian is
 * not an app language (pick-language-scope A).
 */
import type { UiLanguage } from "@/lib/language-model";

export type GuidanceExtraLang = "ru" | "uk" | "tr" | "ar";
export const GUIDANCE_EXTRA_LANGS: readonly GuidanceExtraLang[] = ["ru", "uk", "tr", "ar"];

/** A guidance statement: German and English required, the other app languages optional. */
export type GuidanceStatement = { de: string; en: string } & Partial<Record<GuidanceExtraLang, string>>;

const NATIVE_NAME: Record<GuidanceExtraLang, string> = {
  ru: "Русский",
  uk: "Українська",
  tr: "Türkçe",
  ar: "العربية",
};

export function isGuidanceExtraLang(value: unknown): value is GuidanceExtraLang {
  return typeof value === "string" && (GUIDANCE_EXTRA_LANGS as readonly string[]).includes(value);
}

/**
 * The visible line for a reader whose language has no reviewed page yet; null
 * when the reader's language is German or English or the page is German.
 */
export function englishVersionNotice(preference: string | null | undefined, pageLang: "de" | "en"): string | null {
  const parts = englishVersionNoticeParts(preference, pageLang);
  return parts ? `${parts.before}${parts.name}${parts.after}` : null;
}

/** The same line in parts, so the language name can be isolated (<bdi>) inside the English sentence. */
export function englishVersionNoticeParts(
  preference: string | null | undefined,
  pageLang: "de" | "en",
): { before: string; name: string; nameLang: GuidanceExtraLang; after: string } | null {
  if (pageLang !== "en" || !isGuidanceExtraLang(preference)) return null;
  return { before: "English version. This page is not available in ", name: NATIVE_NAME[preference], nameLang: preference, after: " yet." };
}

/** Text of a statement in a reviewed language, else English (German for German). */
export function statementText(
  statement: GuidanceStatement,
  preference: UiLanguage,
  reviewed: readonly UiLanguage[],
): string {
  if (preference === "de") return statement.de;
  if (isGuidanceExtraLang(preference) && reviewed.includes(preference)) {
    const text = statement[preference];
    if (text && guidanceParityIssues(statement.de, text).length === 0) return text;
  }
  return statement.en;
}

/**
 * Every date, time, amount and count in a guidance string, normalised so
 * language formats compare: ISO and dotted dates become YYYY-MM-DD or MM-DD,
 * times HH:MM, other numbers as digits. Month names are not parsed, so a
 * translation must keep dates numeric or as in the German row.
 */
export function guidanceNumbers(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  rest = rest.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => {
    out.push(`${y}-${m}-${d}`);
    return " ";
  });
  rest = rest.replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (_, d, m, y) => {
    out.push(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    return " ";
  });
  rest = rest.replace(/\b(\d{1,2})[:.](\d{2})(?:\s*(?:Uhr|h))?\b/g, (_, h, min) => {
    out.push(`${h.padStart(2, "0")}:${min}`);
    return " ";
  });
  for (const m of rest.matchAll(/\d+(?:[.,]\d+)?/g)) out.push(m[0].replace(",", "."));
  return out.sort();
}

/** Differences between the German row and a translation; [] means the facts match. */
export function guidanceParityIssues(de: string, translated: string): string[] {
  const a = guidanceNumbers(de);
  const b = guidanceNumbers(translated);
  const issues: string[] = [];
  const count = (list: string[]) => list.reduce((map, v) => map.set(v, (map.get(v) ?? 0) + 1), new Map<string, number>());
  const ca = count(a);
  const cb = count(b);
  for (const [v, n] of ca) if ((cb.get(v) ?? 0) !== n) issues.push(`missing or changed: ${v}`);
  for (const [v, n] of cb) if ((ca.get(v) ?? 0) !== n) issues.push(`added: ${v}`);
  return [...new Set(issues)];
}
