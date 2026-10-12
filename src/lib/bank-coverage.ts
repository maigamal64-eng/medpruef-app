import type { SupabaseClient } from "@supabase/supabase-js";
import { isGmRow } from "@/lib/gm-practice";

export const BANKS = ["kenntnispruefung", "kmp_innsbruck", "pharma"] as const;
export type Bank = typeof BANKS[number];
export interface BankMetadata {
  exam_type: string;
  exam_dates: string[] | null;
  tags: string[] | null;
}

/** Tags record correction dates, not a comprehensive modification timestamp. */
export function correctionDate(tag: string): string | null {
  if (!/^(visite-|prefix-fixed-|track-b-)/.test(tag)) return null;
  const value = tag.match(/(\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)$/)?.[1];
  if (!value) return null;
  if (value.length === 10 && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) return null;
  return value;
}

export function summarizeBankCoverage(rows: readonly BankMetadata[]) {
  return BANKS.map((bank) => {
    // a44: Gerichtsmedizin rows sit in the pharma bank (pick-gm-placement B) but
    // are not Rezeptierkunde material; they never move the pharma coverage line.
    const items = rows.filter((row) => row.exam_type === bank && !(bank === "pharma" && isGmRow(row)));
    const months = items.flatMap((row) => row.exam_dates ?? [])
      .filter((value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)).sort();
    const updates = items.flatMap((row) => (row.tags ?? []).map(correctionDate))
      .filter((value): value is string => value !== null).sort();
    const latest = updates.at(-1) ?? null;
    return {
      bank,
      active_questions: items.length,
      latest_sitting_month: months.at(-1) ?? null,
      sitting_status: months.length ? "recorded" : "no sitting data",
      last_content_update: latest,
      content_update_precision: latest ? latest.length === 10 ? "day" : "month" : null,
      content_update_basis: "recorded correction tags",
    };
  });
}

/** Read every page; PostgREST's row cap must not silently truncate coverage. */
export async function readBankCoverage(db: SupabaseClient) {
  const rows: BankMetadata[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("questions")
      .select("id, exam_type, exam_dates, tags").eq("is_active", true)
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error("Bank coverage unavailable");
    rows.push(...(data ?? []) as BankMetadata[]);
    if (!data || data.length < pageSize) break;
  }
  return {
    banks: summarizeBankCoverage(rows),
    checked_at: new Date().toISOString(),
    source: "MedPrüf active question-bank metadata",
    status: "reported",
    note: "Correction tags record some updates. The bank has no comprehensive modification timestamp. Sitting months describe bank coverage, not upcoming exam dates.",
  };
}
