// Server only: imports the full provenance record. Never import from a client module.
import provenance from "@/lib/guidance-data/bank-provenance.data.json";
import { BANK_SOURCES, reviewDueOn } from "@/lib/bank-provenance";
import { BANKS, type Bank } from "@/lib/bank-coverage";

export interface BankReview {
  bank: Bank;
  /** Oldest deliberate source review of the bank (pick-bank-provenance A). */
  reviewed_on: string | null;
  /** Day after which that review counts as stale; the stamp then says so. */
  review_due_on: string | null;
  description: { de: string; en: string };
}

/**
 * Public projection of the provenance record for the freshness stamp (CNT-01,
 * TR-04). Only the reviewed date and the public description leave the server;
 * rights notes and lineage stay internal.
 */
export function bankReviews(): BankReview[] {
  const banks = provenance.banks as Record<Bank, { public_description: { de: string; en: string } }>;
  return BANKS.map((bank) => {
    const sources = BANK_SOURCES.filter((s) => s.exam_type === bank);
    const oldest = sources.map((s) => s.reviewed_on).sort()[0] ?? null;
    const due = sources.map(reviewDueOn).sort()[0] ?? null;
    return { bank, reviewed_on: oldest, review_due_on: due, description: banks[bank].public_description };
  });
}
