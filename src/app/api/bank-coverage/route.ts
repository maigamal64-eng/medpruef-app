import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase";
import { readBankCoverage } from "@/lib/bank-coverage";
import { bankReviews } from "@/lib/bank-freshness";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const coverage = unstable_cache(() => readBankCoverage(getServiceClient()), ["bank-coverage-v1"], { revalidate: 300 });

// Aggregates only: this route never serves question content or identifiers.
export async function GET() {
  try {
    return NextResponse.json({ ...(await coverage()), reviews: bankReviews() }, { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } });
  } catch {
    return NextResponse.json({ error: "Bank coverage temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
