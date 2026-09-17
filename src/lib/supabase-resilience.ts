/**
 * Small, explicit circuit-breaker helpers for temporary Supabase/API outages.
 *
 * These are deliberately server-only policy helpers. They never fabricate a
 * user or an admin role: callers may use a recently verified value, or fail
 * closed with a retryable response.
 */

const OUTAGE_MARKERS = [
  "522",
  "504",
  "503",
  "timeout",
  "timed out",
  "fetch failed",
  "network",
  "econnreset",
  "econnrefused",
  "etimedout",
];

export function isSupabaseTimeout(error: unknown): boolean {
  if (!error) return false;
  const candidate = error as { message?: unknown; code?: unknown; status?: unknown };
  const message = [candidate.message, candidate.code, candidate.status]
    .filter(Boolean)
    .map(String)
    .join(" ")
    .toLowerCase();
  return OUTAGE_MARKERS.some((marker) => message.includes(marker));
}

/** Kill switch for write-only telemetry. Defaults off so production behavior
 * is unchanged until explicitly enabled in Vercel. */
export function analyticsWritesDisabled(): boolean {
  return process.env.DISABLE_ANALYTICS_WRITES === "true";
}

/** Emergency mode only. It permits a short-lived, previously verified normal
 * user cache, never a synthetic identity or an admin fallback. */
export function supabaseDegradedModeEnabled(): boolean {
  return process.env.SUPABASE_DEGRADED_MODE === "true";
}
