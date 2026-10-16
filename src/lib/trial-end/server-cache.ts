/**
 * Per-instance caches of /api/trial-end (a-trial-end-decision). Kept outside
 * the route file because a Next route may export only its handlers and
 * config; tests reset them through resetTrialEndCache.
 */
// An account without a reverse trial, or one that ever paid, stays "none":
// this instance remembers it for 5 minutes so a Home load does not repeat
// the reads (a-db-relief rule).
const NO_TTL_MS = 5 * 60_000;
export const noUntil = new Map<string, number>();
/** Test seam. */
export function resetTrialEndCache(): void { noUntil.clear(); viewCache.clear(); }
export function rememberNo(userId: string, now: number) {
  if (noUntil.size > 5_000) noUntil.clear();
  noUntil.set(userId, now + NO_TTL_MS);
}

// A running-out or ended trial: the answer without the Home marker is kept per
// instance for 5 minutes (never past the trial end, and keyed on the access
// the guard read, so a purchase or grant is seen at once). Reviewer P2-1.
export const VIEW_TTL_MS = 5 * 60_000;
type CachedView = { until: number; access: string; body: Record<string, unknown> };
export const viewCache = new Map<string, CachedView>();
export function cacheView(userId: string, access: string, body: Record<string, unknown>, until: number) {
  if (viewCache.size > 5_000) viewCache.clear();
  viewCache.set(userId, { until, access, body });
}

