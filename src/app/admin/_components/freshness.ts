/**
 * Freshness rule for admin pages (a18, UX-ADM-31, ADM-20 A).
 *
 * The badge is derived from the page's own load, never set by hand:
 *   LIVE         realtime connected and the last load succeeded. Admin
 *                realtime is off (ADM-20 A: deny-all rules deliver no
 *                events), so no admin page passes realtimeConnected today.
 *   NEAR-LIVE    last successful load under 60 seconds ago.
 *   CACHED       data older than that.
 *   DISCONNECTED the last load failed (with or without older data).
 * "Updated hh:mm" (Vienna time) sits beside it and turns amber once the data
 * is older than three poll intervals (60 s when the page does not poll).
 */

export type Freshness = "live" | "near-live" | "cached" | "disconnected";

export interface LoadState {
  loading: boolean;
  /** Any truthy value means the last load failed. */
  error?: unknown;
  /** Epoch ms of the last successful load, when the page knows it. */
  updatedAt?: number | null;
}

export const NEAR_LIVE_MS = 60_000;
export const DEFAULT_POLL_MS = 60_000;

export interface FreshnessView {
  badge: Freshness | null;
  /** "Updated 14:03", "Last good 14:03", "Loading", "Not loaded". */
  stamp: string | null;
  stale: boolean;
}

const VIENNA_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" });

export function viennaClock(ms: number): string {
  return VIENNA_TIME.format(new Date(ms));
}

export function deriveFreshness(
  state: { loading: boolean; error?: unknown; updatedAt: number | null },
  now: number,
  options: { pollMs?: number; realtimeConnected?: boolean } = {},
): FreshnessView {
  const { updatedAt } = state;
  const staleAfter = 3 * (options.pollMs ?? DEFAULT_POLL_MS);
  if (state.error) {
    return { badge: "disconnected", stamp: updatedAt ? `Last good ${viennaClock(updatedAt)}` : "Not loaded", stale: true };
  }
  if (updatedAt == null) {
    return { badge: null, stamp: state.loading ? "Loading" : null, stale: false };
  }
  const age = Math.max(0, now - updatedAt);
  const badge: Freshness = options.realtimeConnected ? "live" : age < NEAR_LIVE_MS ? "near-live" : "cached";
  return { badge, stamp: `Updated ${viennaClock(updatedAt)}`, stale: age > staleAfter };
}
