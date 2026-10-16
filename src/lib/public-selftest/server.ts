/**
 * a-public-selftest: the one database read of the public self-check. Server only.
 *
 * Reads only the allowlisted ids of one bank (never an id from the request),
 * active rows of that bank, and keeps a row only while it is inside the free
 * set and its served text still has the hash the Medic reads approved. The
 * result goes through the shared Data Cache for an hour, so a public page does
 * not touch the database per visitor; a failed or short read throws and is
 * never kept.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readThrough } from "@/lib/data-cache";
import { BANK_CACHE_TAGS } from "@/lib/bank-cache-tags";
import { freeSetIds } from "@/lib/free-set";
import { filterDisplayableChoices } from "@/lib/mcq";
import { rowKeyFingerprint } from "@/lib/answer-key-fingerprint";
import {
  SELFTEST_ALLOWLIST_VERSION,
  SELFTEST_MIN_ITEMS,
  SELFTEST_SIZE,
  allowlistFor,
  selftestDurationS,
  type SelftestBank,
  type SelftestItem,
  type SelftestPayload,
} from "./index";
import { servedContentHash } from "./served-hash";

export const SELFTEST_CACHE_SECONDS = 60 * 60;

export class SelftestUnavailableError extends Error {
  constructor(public readonly reason: "too_few" | "read_failed", public readonly kept = 0) {
    super(`selftest unavailable: ${reason}`);
    this.name = "SelftestUnavailableError";
  }
}

interface Row {
  id: number;
  question: string | null;
  choices: unknown;
  answer: string | null;
  distractors: unknown;
  topic: string | null;
  exam_type: string | null;
  is_active: boolean | null;
}

/** Pure: allowlist order, intact rows only, first SELFTEST_SIZE. Exported for tests. */
export function buildItems(bank: SelftestBank, rows: readonly Row[]): SelftestItem[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const free = new Set(freeSetIds(bank));
  const items: SelftestItem[] = [];
  for (const entry of allowlistFor(bank)) {
    if (items.length >= SELFTEST_SIZE) break;
    const row = byId.get(entry.id);
    if (!row || row.is_active !== true || row.exam_type !== bank || !free.has(row.id)) continue;
    if (servedContentHash(row) !== entry.served_sha256) continue;
    const stored = Array.isArray(row.choices) ? (row.choices as { text?: string | null; correct?: boolean }[]) : [];
    const options = filterDisplayableChoices(stored).map((c) => ({ text: String(c.text ?? ""), correct: c.correct === true }));
    const required = options.filter((o) => o.correct).length;
    if (options.length < 2 || required === 0 || !row.question) continue;
    items.push({
      id: row.id,
      field: row.topic ?? entry.field,
      question: row.question,
      options,
      required,
      keyFingerprint: rowKeyFingerprint(row.id, row),
    });
  }
  return items;
}

async function readFresh(sb: SupabaseClient, bank: SelftestBank): Promise<SelftestPayload> {
  const ids = allowlistFor(bank).map((e) => e.id);
  const { data, error } = await sb
    .from("questions")
    .select("id, question, choices, answer, distractors, topic, exam_type, is_active")
    .in("id", ids)
    .eq("exam_type", bank)
    .eq("is_active", true);
  if (error) throw error;
  const items = buildItems(bank, (data ?? []) as Row[]);
  if (items.length < SELFTEST_MIN_ITEMS) throw new SelftestUnavailableError("too_few", items.length);
  return { bank, version: SELFTEST_ALLOWLIST_VERSION, durationS: selftestDurationS(items.length), items };
}

/** Changes when the free set of the bank changes, so a regenerated free set never serves a cached row outside it. */
function freeSetKey(bank: SelftestBank): string {
  return createHash("sha256").update(freeSetIds(bank).join(",")).digest("hex").slice(0, 12);
}

/**
 * Tagged bank:selftest: an admin edit of a stem, the options, the key or the
 * active state purges it (bank-cache.ts), so the next read re-checks the hashes.
 */
export async function loadSelftest(sb: SupabaseClient, bank: SelftestBank): Promise<SelftestPayload> {
  return readThrough(["public-selftest", bank, SELFTEST_ALLOWLIST_VERSION, freeSetKey(bank)], () => readFresh(sb, bank), {
    revalidate: SELFTEST_CACHE_SECONDS,
    tags: [BANK_CACHE_TAGS.selftest],
  });
}
