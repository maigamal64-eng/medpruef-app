import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase";
import { readBankCoverage } from "@/lib/bank-coverage";
import { bankReviews } from "@/lib/bank-freshness";
import { BANK_CACHE_SECONDS, BANK_CACHE_TAGS } from "@/lib/bank-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
// a-db-relief-1 (T0b): the whole-bank pager runs once a day (or after an
// admin purge of its own tag), not every 5 minutes. A failed read throws
// inside the cache, so "unavailable" is never kept.
const coverage = unstable_cache(() => readBankCoverage(getServiceClient()), ["bank-coverage-v1"], { revalidate: BANK_CACHE_SECONDS, tags: [BANK_CACHE_TAGS.coverage] });

// Aggregates only: this route never serves question content or identifiers.
export async function GET() {
  try {
    return NextResponse.json({ ...(await coverage()), reviews: bankReviews() }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" } });
  } catch {
    return NextResponse.json({ error: "Bank coverage temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
