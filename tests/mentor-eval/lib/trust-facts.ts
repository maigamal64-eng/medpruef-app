/** Adversarial data fixtures are isolated from committed official facts. */
import { MentorFactsLoader } from "@/lib/mentor/facts-loader";
import type { MentorFact } from "@/lib/mentor/seam";
import type { GoldenCase } from "./types";

export function trustFactLoader(scenario: NonNullable<GoldenCase["fact_scenario"]>): MentorFactsLoader {
  const fact: MentorFact = {
    id: "trust.scenario.date", exam_key: "general", topic: "dates", filing_university: "all",
    text_de: "Synthetic trust registration date: 2099-04-01.", text_en: "Synthetic trust registration date: 2099-04-01.",
    aliases: ["synthetic", "trust", "registration"], source_url: "https://www.meduniwien.ac.at/",
    source_label: "Synthetic trust fixture", edition: "synthetic", read_on: "2026-10-10",
    review_every_days: 30, status: "live", verdict: "confirmed",
  };
  if (scenario === "stale") fact.read_on = "2025-01-01";
  if (scenario === "contradicted") fact.verdict = "contradicted";
  if (scenario === "needs_review") fact.status = "needs_review";
  if (scenario === "retracted") fact.status = "retracted";
  if (scenario === "expired") fact.valid_until = "2025-12-31";
  const records = scenario === "conflicting_duplicate" ? [fact, { ...fact, text_de: "Synthetic date 2099-05-01.", text_en: "Synthetic date 2099-05-01." }] : [fact];
  return new MentorFactsLoader({ files: () => ({ files: [{ file: "trust-fixture.json", records }], errors: [] }), sittings: [], appFacts: () => [], log: () => {} });
}
