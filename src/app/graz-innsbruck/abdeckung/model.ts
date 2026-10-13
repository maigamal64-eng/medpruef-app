import data from "@/lib/guidance-data/graz-innsbruck.data.json";

export const COVERAGE = data.coverage;
export type CoverageLanguage = "de" | "en";
export interface CoverageRow { id: number; tags: string[] | null }
export interface CoverageSnapshot {
  checkedAt: string;
  active: number;
  classified: number;
  pendingReview: number;
  invalidFieldTags: number;
  fields: { key: string; count: number }[];
}

/** Count each active row once. Unknown or conflicting field tags are not coverage. */
export function summarizeCoverage(rows: readonly CoverageRow[], checkedAt: string): CoverageSnapshot {
  const counts = new Map(COVERAGE.fields.map((field) => [field.key, 0]));
  const seen = new Set<number>();
  let pendingReview = 0, invalidFieldTags = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) throw new Error("Invalid coverage row");
    seen.add(row.id);
    if (row.tags !== null && (!Array.isArray(row.tags) || row.tags.some((tag) => typeof tag !== "string"))) throw new Error("Invalid coverage tags");
    const tags = (row.tags ?? []).filter((tag) => tag.startsWith("field:"));
    if (!tags.length) { pendingReview++; continue; }
    const key = tags[0].slice("field:".length);
    if (tags.length !== 1 || !counts.has(key)) { invalidFieldTags++; continue; }
    counts.set(key, counts.get(key)! + 1);
  }
  const fields = [...counts].map(([key, count]) => ({ key, count }));
  const classified = fields.reduce((sum, field) => sum + field.count, 0);
  return { checkedAt, active: rows.length, classified, pendingReview, invalidFieldTags, fields };
}

export const COPY = {
  de: {
    title: "Übungsabdeckung für Graz und Innsbruck", eyebrow: "STICHPROBENTEST IN ÖSTERREICH",
    intro: "Welche Fachbereiche sind in unserer Übungsbank zugeordnet? Hier sehen Sie den aktuellen Bestand und die Grenzen dieser Übersicht.",
    scope: "Graz und Innsbruck nutzen hier denselben MedPrüf-Übungsbestand. Die Zahlen sind keine getrennten Fragensammlungen der Universitäten. Die Zahlen belegen keine vollständige Prüfungsabdeckung und nicht die medizinische Richtigkeit jeder Frage.",
    pendingBefore: "Die Fachzahlen schließen", pendingAfter: "aktive Fragen ohne Fachzuordnung aus, deren Zuordnung noch geprüft werden muss.",
    invalidBefore: "Zusätzlich ausgeschlossen:", invalidAfter: "Fragen mit unbekannten oder widersprüchlichen Fachmarkierungen.",
    active: "Aktive Übungsfragen", classified: "Eindeutig zugeordnet", pending: "Zuordnung ausstehend",
    field: "Fachbereich", count: "Zugeordnete Übungsfragen", gaps: "Lücken und Grenzen",
    empty: "Keine eindeutig zugeordnete Übungsfrage im aktuellen Bestand.",
    unconfirmed: "Vollständige Abdeckung für diesen Prüfungsort nicht bestätigt.",
    countsStatus: "Berichtet: MedPrüf-Bestand", officialStatus: "Amtlich: Fachbereichsliste", unknownStatus: "Nicht bestätigt: Abdeckung des gesamten Prüfungsstoffs",
    checked: "Geprüft am", against: "gegen", edition: "Ausgabe", readAt: "Bestand abgerufen am",
    cacheBefore: "Die Zahlen werden serverseitig zwischengespeichert und spätestens nach", cacheAfter: "Stunden aktualisiert. Änderungen während des Abrufs können erst beim nächsten Abruf sichtbar werden.",
    method: "Gezählt werden nur aktive Stichprobentest-Fragen mit genau einer bekannten Fachmarkierung. Nicht zugeordnete Fragen werden nicht aus ihrem alten Themenlabel abgeleitet. Die Fachbereichsliste ist amtlich, die Bestandszahlen stammen von MedPrüf.",
    unavailable: "Bestandszahlen sind gerade nicht verfügbar. Bitte laden Sie die Seite später erneut. Eine fehlgeschlagene Abfrage bedeutet nicht, dass ein Fach keine Übungsfragen hat.",
    back: "Orientierung für Graz und Innsbruck", practice: "Zum Stichprobentest", language: "Sprache",
  },
  en: {
    title: "Practice coverage for Graz and Innsbruck", eyebrow: "STICHPROBENTEST IN AUSTRIA",
    intro: "Which fields are classified in our practice bank? See the current inventory and the limits of this overview.",
    scope: "Graz and Innsbruck use the same MedPrüf practice bank here. These are not separate university question collections. Counts establish no complete exam coverage and not the clinical correctness of every question.",
    pendingBefore: "Field counts exclude", pendingAfter: "active questions without a field assignment, pending classification review.",
    invalidBefore: "Also excluded:", invalidAfter: "questions with unknown or conflicting field tags.",
    active: "Active practice questions", classified: "Unambiguously classified", pending: "Classification pending",
    field: "Field", count: "Classified practice questions", gaps: "Gaps and limitations",
    empty: "No unambiguously classified practice question in the current inventory.",
    unconfirmed: "Complete coverage for this exam venue is not confirmed.",
    countsStatus: "Reported: MedPrüf inventory", officialStatus: "Official: field list", unknownStatus: "Not confirmed: coverage of the whole exam",
    checked: "Checked on", against: "against", edition: "Edition", readAt: "Inventory retrieved on",
    cacheBefore: "Counts are cached on the server and refresh within", cacheAfter: "hours. Changes during retrieval may only appear on the next retrieval.",
    method: "Only active Stichprobentest questions with exactly one known field tag are counted. Unclassified questions are not inferred from legacy topic labels. The field list is official; inventory counts come from MedPrüf.",
    unavailable: "Inventory counts are currently unavailable. Please reload later. A failed query does not mean a field has no practice questions.",
    back: "Guidance for Graz and Innsbruck", practice: "Explore the Stichprobentest", language: "Language",
  },
} as const;
