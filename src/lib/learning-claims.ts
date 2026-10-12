/**
 * Public learning-feature claims (LX-30, UX-GLOBAL-07). Every /pricing cohort
 * bullet, /landing feature card and /landing switch point (LX-18) renders from a row in
 * src/lib/guidance-data/learning-claims.copy.json (provenance per id: learning-claims.data.json,
 * test-only, never bundled); this module fills the
 * placeholders from src/lib/content-truth.ts. Framework-agnostic.
 */
import data from "@/lib/guidance-data/learning-claims.copy.json";
import {
  AI_DAILY_LIMIT_WORDING,
  EXAM_SIMULATION_HOURS,
  EXPLANATION_LANGUAGES,
  LANGUAGE_NAMES,
  SUPPORT,
  type ClaimLang,
} from "@/lib/content-truth";

export type ClaimTextLang = "de" | "en";
export interface LearningClaim {
  id: string;
  surface: "pricing.cohort" | "landing.features" | "landing.switch";
  tag?: string;
  title?: Record<ClaimTextLang, string>;
  text: Record<ClaimTextLang, string>;
}

export const LEARNING_CLAIMS = data.claims as LearningClaim[];

function joinList(langs: readonly ClaimLang[], lang: ClaimTextLang): string {
  const names = langs.map((l) => LANGUAGE_NAMES[l][lang]);
  if (names.length < 2) return names.join("");
  const and = lang === "de" ? " und " : " and ";
  return `${names.slice(0, -1).join(", ")}${and}${names.at(-1)}`;
}

/** Languages a public claim may count: the German original, claimed and unreviewed translations. */
export const PUBLIC_EXPLANATION_LANGUAGES: readonly ClaimLang[] = [
  EXPLANATION_LANGUAGES.original,
  ...EXPLANATION_LANGUAGES.claimed,
  ...EXPLANATION_LANGUAGES.unreviewed,
];

export function claimPlaceholders(lang: ClaimTextLang): Record<string, string> {
  return {
    explanationLanguageCount: String(PUBLIC_EXPLANATION_LANGUAGES.length),
    noteLanguageCount: String(PUBLIC_EXPLANATION_LANGUAGES.length),
    claimedLanguages: joinList([EXPLANATION_LANGUAGES.original, ...EXPLANATION_LANGUAGES.claimed], lang),
    unreviewedLanguages: joinList(EXPLANATION_LANGUAGES.unreviewed, lang),
    aiDailyLimit: AI_DAILY_LIMIT_WORDING[lang],
    examHours: String(EXAM_SIMULATION_HOURS),
    reportAckDays: String(SUPPORT.reportAcknowledgeWorkingDays),
  };
}

export function fillClaim(template: string, lang: ClaimTextLang): string {
  const values = claimPlaceholders(lang);
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in values)) throw new Error(`Unknown claim placeholder ${whole}`);
    return values[key];
  });
}

function claim(id: string): LearningClaim {
  const found = LEARNING_CLAIMS.find((c) => c.id === id);
  if (!found) throw new Error(`Unregistered learning claim ${id}`);
  return found;
}

/** Bilingual text of one registered claim. */
export function claimText(id: string): Record<ClaimTextLang, string> {
  const c = claim(id);
  return { de: fillClaim(c.text.de, "de"), en: fillClaim(c.text.en, "en") };
}

/** Bilingual title of one registered claim (landing cards). */
export function claimTitle(id: string): Record<ClaimTextLang, string> {
  const c = claim(id);
  if (!c.title) throw new Error(`Claim ${id} has no title`);
  return { de: fillClaim(c.title.de, "de"), en: fillClaim(c.title.en, "en") };
}

/** All claims for one surface, in register order. */
export function claimsFor(surface: LearningClaim["surface"]): LearningClaim[] {
  return LEARNING_CLAIMS.filter((c) => c.surface === surface);
}
