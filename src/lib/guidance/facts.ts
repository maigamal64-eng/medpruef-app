import data from "@/lib/guidance-data/wien-deadlines.data.json";

export type GuidanceLang = "de" | "en";
export type FactStatus = "official" | "reported" | "not_confirmed";
export interface GuidanceFact {
  id: string;
  statement: Record<GuidanceLang, string>;
  status: FactStatus;
  source_url: string;
  source_label: string;
  edition: string;
  read_on: string;
  review_every_days: number;
  applies_to: string[];
  exam_key?: string;
  topic?: string;
  filing_university?: string;
  verdict?: string;
}

export function loadFacts(pageId: string): GuidanceFact[] {
  return (data.facts as GuidanceFact[]).filter((fact) => fact.applies_to.includes(pageId));
}

export function factAgeDays(fact: GuidanceFact, now = new Date()): number {
  return Math.floor((now.getTime() - Date.parse(`${fact.read_on}T00:00:00Z`)) / 86_400_000);
}
export const isFactStale = (fact: GuidanceFact, now = new Date()) => factAgeDays(fact, now) > fact.review_every_days;
// The warning precedes the build gate by a grace period.
export const factReviewOverdue = (fact: GuidanceFact, now = new Date()) => factAgeDays(fact, now) > fact.review_every_days + 14;
export function formatGuidanceDate(value: string, lang: GuidanceLang): string {
  return new Intl.DateTimeFormat(lang === "de" ? "de-AT" : "en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna",
  }).format(new Date(`${value}T12:00:00Z`));
}
export const guidanceLang = (value: string | string[] | undefined): GuidanceLang => value === "en" ? "en" : "de";
