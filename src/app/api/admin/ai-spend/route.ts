import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { isMissingRelation, utcMonthStart, workspaceSpendMeter, type SpendDb } from "@/lib/ai/workspace-spend";
import { aggregateFeatureSpend, type CallLogRow, type LedgerRow } from "@/lib/ai/feature-spend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 1000;
const MAX_PAGES = 50;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** All rows or null (an unreadable or over-long read is "unknown", never a low number). */
async function allRows<T>(page: (from: number, to: number) => Page<T>, missingIsEmpty = false): Promise<T[] | null> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, i * PAGE + PAGE - 1);
    // The mentor ledger before its changeset: no mentor rows, not a failure.
    if (error && missingIsEmpty && isMissingRelation(error)) return out;
    if (error || !Array.isArray(data)) return null;
    out.push(...data);
    if (data.length < PAGE) return out;
  }
  return null;
}

/**
 * GET /api/admin/ai-spend (a-anthropic-features, revenue.read).
 *
 * The Anthropic workspace spend meter (today and this UTC month against the
 * workspace limit, the 70 % alarm and 95 % soft stop) and, per feature, the
 * month's calls, cost, tokens and prompt-cache hit rate. Counts and money
 * only, no learner identity.
 */
export const GET = adminRouteShell(
  async () => {
    const db = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
    const now = new Date();
    const since = utcMonthStart(now).toISOString();
    const [meter, calls, ledger] = await Promise.all([
      workspaceSpendMeter(db as unknown as SpendDb, { now, fresh: true }),
      allRows<CallLogRow>((from, to) =>
        db
          .from("ai_call_log")
          .select("route, provider, cost_usd, in_tokens, out_tokens, cache_read_tokens, cache_write_tokens")
          .gte("created_at", since)
          .order("id", { ascending: true })
          .range(from, to) as unknown as Page<CallLogRow>,
      ),
      allRows<LedgerRow>((from, to) =>
        db
          .from("ai_usage_ledger")
          .select("kind, cost_micro, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens")
          .in("kind", ["settle", "house_cost"])
          .gte("created_at", since)
          .order("id", { ascending: true })
          .range(from, to) as unknown as Page<LedgerRow>,
        true,
      ),
    ]);
    return NextResponse.json(
      {
        meter,
        features: calls && ledger ? aggregateFeatureSpend(calls, ledger) : null,
        features_failed: !calls || !ledger,
        month_start: since,
        generated_at: now.toISOString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
  { route: "/api/admin/ai-spend", rateLimit: { limit: 30, windowMs: 60_000 } },
);
