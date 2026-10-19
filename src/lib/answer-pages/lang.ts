import { guidanceLang } from "@/lib/guidance/facts";
import { answerPath } from "./registry";
import type { AnswerLang, AnswerPage } from "./types";

/**
 * Language of an answer page request (a-seo-articles-en-1019). A guide with an
 * English slug has one URL per language: the English slug is English, the German
 * slug is German, and ?lang= on the wrong one returns the other URL to redirect to
 * (other query parameters, such as utm_*, are kept).
 */
export function resolveAnswerLang(page: AnswerPage, slug: string, query: Record<string, string | string[] | undefined>): { lang: AnswerLang; redirectTo: string | null } {
  const raw = query.lang;
  const asked = typeof raw === "string" ? raw.toLowerCase() : raw;
  if (!page.en_slug) return { lang: guidanceLang(asked), redirectTo: null };
  const lang: AnswerLang = slug === page.en_slug ? "en" : "de";
  // Only an explicit ?lang=de or ?lang=en moves the visitor; anything else stays put.
  const wanted: AnswerLang | null = asked === "de" || asked === "en" ? asked : null;
  if (wanted === null || wanted === lang) return { lang, redirectTo: null };
  const rest = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "lang" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) rest.append(key, v);
  }
  const qs = rest.toString();
  return { lang, redirectTo: `${answerPath(page, wanted)}${qs ? `?${qs}` : ""}` };
}
