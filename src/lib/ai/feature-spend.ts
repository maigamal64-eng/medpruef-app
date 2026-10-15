/**
 * Month-to-date AI spend and prompt-cache hit rate per feature
 * (a-anthropic-features). Pure aggregation over ai_call_log rows (legacy
 * routes) and mentor ledger consumption rows; the admin route pages the reads.
 */
import { cacheHitRate } from "./cache-plan";

export interface CallLogRow {
  route: string | null;
  provider: string | null;
  cost_usd: number | string | null;
  in_tokens: number | null;
  out_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
}

export interface LedgerRow {
  kind: string | null;
  cost_micro: number | string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
}

export interface FeatureSpend {
  feature: string;
  calls: number;
  costMicro: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** cache reads / (uncached input + cache reads + cache writes); null without prompt tokens. */
  hitRate: number | null;
}

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Features in a fixed order; unknown legacy routes (rows before R2) are "other". */
export const FEATURE_ORDER = ["mentor", "ai_chat", "translate", "notes_transform", "notes_safety", "other"] as const;

export function aggregateFeatureSpend(calls: readonly CallLogRow[], ledger: readonly LedgerRow[]): FeatureSpend[] {
  const by = new Map<string, FeatureSpend>();
  const get = (f: string) => {
    let row = by.get(f);
    if (!row) {
      row = { feature: f, calls: 0, costMicro: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, hitRate: null };
      by.set(f, row);
    }
    return row;
  };
  for (const r of calls) {
    if (r.provider !== "anthropic" || r.route === "mentor") continue;
    const f = r.route && (FEATURE_ORDER as readonly string[]).includes(r.route) ? r.route : "other";
    const row = get(f);
    row.calls++;
    row.costMicro += Math.ceil(n(r.cost_usd) * 1_000_000 - 1e-6);
    row.inputTokens += n(r.in_tokens);
    row.outputTokens += n(r.out_tokens);
    row.cacheReadTokens += n(r.cache_read_tokens);
    row.cacheWriteTokens += n(r.cache_write_tokens);
  }
  for (const r of ledger) {
    if (r.kind !== "settle" && r.kind !== "house_cost") continue;
    const row = get("mentor");
    row.calls++;
    row.costMicro += Math.ceil(n(r.cost_micro));
    row.inputTokens += n(r.input_tokens);
    row.outputTokens += n(r.output_tokens);
    row.cacheReadTokens += n(r.cache_read_tokens);
    row.cacheWriteTokens += n(r.cache_write_tokens);
  }
  const out = [...by.values()].map((r) => ({ ...r, hitRate: cacheHitRate({ input: r.inputTokens, cacheRead: r.cacheReadTokens, cacheWrite: r.cacheWriteTokens }) }));
  return out.sort((a, b) => FEATURE_ORDER.indexOf(a.feature as (typeof FEATURE_ORDER)[number]) - FEATURE_ORDER.indexOf(b.feature as (typeof FEATURE_ORDER)[number]));
}
