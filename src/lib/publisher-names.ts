/** Publisher names as shown per language (exam-dates.ts stores the official German name). Dependency-free so client components can use it. */
const PUBLISHER_EN: Record<string, string> = {
  "MedUni Wien": "MedUni Vienna",
  "Medizinische Universität Innsbruck": "Medical University of Innsbruck",
};
export function publisherName(publisher: string, lang: "de" | "en"): string {
  return lang === "en" ? PUBLISHER_EN[publisher] ?? publisher : publisher;
}
