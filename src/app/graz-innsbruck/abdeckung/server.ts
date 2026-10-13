import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase";
import { COVERAGE, summarizeCoverage, type CoverageRow, type CoverageSnapshot } from "./model";
import { BANK_CACHE_TAGS } from "@/lib/bank-cache-tags";

const PAGE_SIZE = 500;
const MAX_ROWS = 20_000;

/** GET only, metadata only, bounded keyset pagination. No question content leaves the server. */
export async function readCoverage(): Promise<CoverageSnapshot> {
  const client = getServiceClient();
  const rows: CoverageRow[] = [];
  const started = Date.now();
  let lastId = 0, expectedTotal: number | null = null;
  while (true) {
    if (Date.now() - started >= 30_000) throw new Error("Coverage read timed out");
    const { data, error, count } = await client.from("questions")
      .select("id,tags", { count: "exact" })
      .eq("exam_type", "kmp_innsbruck").eq("is_active", true).gt("id", lastId)
      .order("id", { ascending: true }).limit(PAGE_SIZE)
      .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(15_000, 30_000 - (Date.now() - started)))));
    if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0) throw new Error("Coverage read unavailable");
    expectedTotal ??= count;
    if (expectedTotal > MAX_ROWS || count !== expectedTotal - rows.length || data.length > PAGE_SIZE || data.length > count) throw new Error("Coverage inventory changed or exceeded limit");
    for (const row of data as CoverageRow[]) {
      if (!Number.isSafeInteger(row.id) || row.id <= lastId) throw new Error("Invalid coverage page order");
      lastId = row.id;
      rows.push(row);
    }
    if (!data.length) {
      if (rows.length !== expectedTotal) throw new Error("Incomplete coverage inventory");
      return summarizeCoverage(rows, new Date().toISOString());
    }
  }
}

// A failed fetch throws inside the cache; the unavailable response is never cached as zero.
// a-db-relief-1 (T0b): 24 h under its own tag, purged by the admin question editor.
const cachedCoverage = unstable_cache(readCoverage, ["b22-gi-coverage-v1"], { revalidate: COVERAGE.cacheSeconds, tags: [BANK_CACHE_TAGS.giCoverage] });
export async function getCoverage(): Promise<CoverageSnapshot | null> {
  try { return await cachedCoverage(); }
  catch { return null; }
}
