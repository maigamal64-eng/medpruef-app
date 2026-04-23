/**
 * flags — feature-flag helper with 60s in-memory cache.
 * §2.9 of the April 23 admin revamp sprint.
 *
 * Usage from any server-side code:
 *   import { flag } from "@/lib/admin/flags";
 *   if (await flag("new_pricing_v2", userId)) { ... }
 *
 * Behavior:
 *  - Fetches the flag row at most once per 60s per function instance.
 *  - Respects the env column: 'production' only fires on VERCEL_ENV=production;
 *    'preview' only on preview; 'development' in dev; 'all' everywhere.
 *  - rollout_pct is a stable hash of (key + userId) → 0-99, allowing
 *    sticky-per-user rollout (same user gets same bucket across calls).
 *  - When userId is omitted, a flag with rollout_pct < 100 never fires
 *    (we can't bucket an anonymous caller).
 */

import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";

interface FlagRow {
  key: string;
  env: "production" | "preview" | "development" | "all";
  enabled: boolean;
  rollout_pct: number;
}

// Per-function-instance cache. Mirror of the rate-limit module's pattern.
const cache = new Map<string, { row: FlagRow | null; at: number }>();
const CACHE_TTL_MS = 60_000;

function currentEnv(): "production" | "preview" | "development" | "all" {
  const v = process.env.VERCEL_ENV;
  if (v === "production") return "production";
  if (v === "preview") return "preview";
  if (v === "development") return "development";
  return "development";
}

/**
 * Deterministic hash of (key + userId) → 0-99 bucket. Stable: same
 * (key, userId) always falls into the same bucket, so rolling from
 * 10% → 20% adds users to the treatment without re-rolling existing ones.
 */
function bucketForUser(key: string, userId: string): number {
  const input = `${key}:${userId}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

export async function flag(key: string, userId?: string): Promise<boolean> {
  try {
    const now = Date.now();
    const hit = cache.get(key);
    let row: FlagRow | null = null;

    if (hit && now - hit.at < CACHE_TTL_MS) {
      row = hit.row;
    } else {
      const sb = getServiceClient();
      const { data } = await sb
        .from("flags")
        .select("key, env, enabled, rollout_pct")
        .eq("key", key)
        .maybeSingle();
      row = (data as FlagRow) ?? null;
      cache.set(key, { row, at: now });
    }

    if (!row || !row.enabled) return false;

    // Env gate
    const env = currentEnv();
    if (row.env !== "all" && row.env !== env) return false;

    // 100% rollout shortcut
    if (row.rollout_pct >= 100) return true;
    if (row.rollout_pct <= 0) return false;

    // Needs a userId for deterministic bucketing
    if (!userId) return false;
    return bucketForUser(key, userId) < row.rollout_pct;
  } catch (err) {
    captureServerError(err, { route: "admin/flags/read", flagKey: key });
    // Fail closed — a broken flag is a disabled flag.
    return false;
  }
}

/**
 * Clear the in-memory cache. Called by the flags admin API after a
 * toggle so the change propagates within the function-instance
 * immediately. Other instances still honor their own 60s TTL.
 */
export function invalidateFlagCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}
