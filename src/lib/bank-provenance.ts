import data from "@/lib/guidance-data/bank-provenance.data.json";

/** One reviewed provenance record per active source_file (CNT-11, TR-05). */
export interface SourceProvenance {
  source_file: string;
  exam_type: "kenntnispruefung" | "kmp_innsbruck" | "pharma";
  active_rows_at_snapshot: number;
  lineage: string;
  origin: string;
  rights_status: "cleared" | "uncleared-logged";
  rights_basis: string;
  keep: string;
  refresh_path: string;
  decision: { ref: string; by: string; on: string; text: string } | null;
  reviewed_on: string;
  review_every_days: number;
}

export const BANK_SOURCES = data.sources as SourceProvenance[];

/** Day (UTC, YYYY-MM-DD) after which a record's review is overdue. */
export function reviewDueOn(source: Pick<SourceProvenance, "reviewed_on" | "review_every_days">): string {
  const due = new Date(`${source.reviewed_on}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + source.review_every_days);
  return due.toISOString().slice(0, 10);
}

/** Records whose review has lapsed on `today` (YYYY-MM-DD). Overdue only strictly after the due day. */
export function overdueSources(today: string, sources: readonly SourceProvenance[] = BANK_SOURCES): SourceProvenance[] {
  return sources.filter((s) => reviewDueOn(s) < today);
}
