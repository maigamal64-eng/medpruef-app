/**
 * Lightweight per-user/per-route rate limiter.
 *
 * Why this shape:
 *
 * Vercel serverless keeps function instances warm for ~5 minutes of
 * inactivity. A burst attacker hitting the same route from the same
 * user id will almost always land on the same instance because Vercel
 * routes warm requests to warm instances. An in-memory sliding-window
 * map catches that path without a network round-trip per request.
 *
 * Across instances, the worst case is that an attacker gets `limit`
 * successful requests per instance before the next one blocks them.
 * For a typical 3–5 concurrent instance pool under normal load, that
 * means the effective ceiling is 3–5× the nominal limit in the worst
 * burst. Acceptable for a launch-readiness gate; real distributed
 * limits ship when Upstash Redis lands.
 *
 * The module is pure TS with no external deps. Import:
 *
 *     import { checkRateLimit } from "@/lib/rate-limit";
 *
 *     const gate = checkRateLimit({
 *       key: `stats:${userId}`,
 *       limit: 30,
 *       windowMs: 60_000,
 *     });
 *     if (!gate.allowed) {
 *       return NextResponse.json(
 *         { error: "Too many requests", retryAfter: gate.retryAfterSec },
 *         { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
 *       );
 *     }
 *
 * Added 2026-04-23 for the launch-readiness P0 (rate-limit
 * `/api/stats`, `/api/referrals/*`, `/api/ai-chat`, `/api/translate`,
 * `/api/checkout/nowpayments`).
 */

type BucketKey = string;

/**
 * A single bucket tracks an array of request timestamps within the
 * current window. Using a plain array keeps the math simple: we drop
 * timestamps older than (now - windowMs) and count what's left.
 *
 * The `Map` is module-scoped — one per function instance. Stale
 * buckets get garbage-collected when no new request keeps them alive;
 * we also explicitly prune on every check to keep the map small.
 */
const buckets = new Map<BucketKey, number[]>();

/** Periodic cleanup so unused keys don't leak. Runs lazily on check. */
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 60_000;

function maybePrune(now: number): void {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  // Remove buckets whose newest timestamp is older than 5 minutes —
  // they can't possibly be within anyone's window.
  const cutoff = now - 5 * 60_000;
  for (const [k, stamps] of buckets) {
    if (stamps.length === 0 || stamps[stamps.length - 1] < cutoff) {
      buckets.delete(k);
    }
  }
}

export interface RateLimitArgs {
  /** Unique key per (user, route, action). e.g. `stats:<userId>` */
  key: string;
  /** Max number of requests allowed in the window */
  limit: number;
  /** Window duration in ms, e.g. 60_000 for "per minute" */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in the current window */
  remaining: number;
  /** When the current window rolls over, as epoch ms */
  resetAt: number;
  /** Seconds until caller can retry — meaningful only when !allowed */
  retryAfterSec: number;
}

/**
 * Check + record a request against a sliding window. Returns
 * `allowed=false` if the caller has exceeded `limit` requests in the
 * last `windowMs` ms. The check itself counts as a request when
 * `allowed=true` (we record the timestamp).
 *
 * Threadsafe within a single Node.js event loop — Node is
 * single-threaded so `Map` mutations here don't race. No mutex.
 */
export function checkRateLimit(args: RateLimitArgs): RateLimitResult {
  const { key, limit, windowMs } = args;
  const now = Date.now();
  maybePrune(now);

  const cutoff = now - windowMs;
  const stamps = buckets.get(key) ?? [];

  // Drop stamps that fell out of the window.
  let firstValidIdx = 0;
  while (firstValidIdx < stamps.length && stamps[firstValidIdx] < cutoff) {
    firstValidIdx += 1;
  }
  const windowStamps = firstValidIdx > 0 ? stamps.slice(firstValidIdx) : stamps;

  if (windowStamps.length >= limit) {
    // Block. retryAfterSec = time until the oldest in-window stamp
    // rolls out, at which point the caller would be back to limit-1
    // in-window stamps.
    const oldestInWindow = windowStamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetAt: oldestInWindow + windowMs,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  // Record this request and return allowed.
  windowStamps.push(now);
  buckets.set(key, windowStamps);

  return {
    allowed: true,
    remaining: Math.max(0, limit - windowStamps.length),
    resetAt: windowStamps[0] + windowMs,
    retryAfterSec: 0,
  };
}

/**
 * Convenience — build a key from (route, userOrIp). Pass the full
 * request URL or just a stable tag like "stats". When no user id
 * is available, fall back to the forwarded IP so unauthenticated
 * abuse still gets throttled.
 */
export function rateKey(
  route: string,
  userIdOrIp: string | null | undefined,
  suffix?: string,
): string {
  const who = userIdOrIp || "anon";
  return suffix ? `${route}:${who}:${suffix}` : `${route}:${who}`;
}

/**
 * Extract a best-effort caller identity for rate-limiting. Prefers
 * user id from auth header, falls back to forwarded IP.
 */
export function callerIdentity(req: {
  headers: { get: (k: string) => string | null };
}): string {
  const userId = req.headers.get("x-user-id");
  if (userId) return userId;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * Helper to build a 429 NextResponse with proper headers. Most
 * callers want:
 *     if (!gate.allowed) return rateLimitResponse(gate);
 */
export interface RateLimitErrorOptions {
  /** Optional custom error message body */
  message?: string;
}

export function rateLimitHeaders(
  gate: RateLimitResult,
  opts: { limit: number },
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(opts.limit),
    "X-RateLimit-Remaining": String(gate.remaining),
    "X-RateLimit-Reset": String(Math.ceil(gate.resetAt / 1000)),
    ...(gate.retryAfterSec > 0
      ? { "Retry-After": String(gate.retryAfterSec) }
      : {}),
  };
}
