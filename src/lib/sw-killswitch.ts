/**
 * sw-killswitch — pure decision logic for the stale-SW kill-switch
 * that runs inline in `src/app/layout.tsx`.
 *
 * Why extracted (post-soft-launch §1.4.8):
 *
 * The stale-SW kill-switch is an inline <script> tag in the root
 * layout because it must run before any bundle hydrates (otherwise the
 * old SW would intercept and serve a stale chunk). The inline form
 * can't be unit-tested directly — no module boundary, no exported
 * symbols. This module provides the PURE decision function the inline
 * script calls via a global (window.__medpruefShouldReloadForStaleSW)
 * so tests can exercise every branch deterministically.
 *
 * The inline script still holds the effectful pieces (timers,
 * serviceWorker.controller.postMessage, caches.delete, location.reload)
 * — only the YES/NO reload decision moves here.
 *
 * Decision rules (match the inline script branches in layout.tsx
 * verbatim — if you change one, change both):
 *
 *   1. If the SW did not respond within 1.5s → reload (the new SW is
 *      deployed; the old one has no GET_BUILD_ID handler and never
 *      answers). Represented by `swBuildId: null`.
 *   2. If the expected build id is empty OR the string literal
 *      "dev-local" → NO reload (we're on localhost / a self-hosted
 *      preview / Vercel preview without a commit-sha env var). Noisy
 *      reload loops on dev would mask real bugs.
 *   3. If the SW reported an empty build id → NO reload. Treated the
 *      same as "no identification" — prefer polite over aggressive.
 *   4. If expected + sw match → NO reload.
 *   5. Otherwise (both present, different) → reload.
 */

export interface KillSwitchInput {
  /** `process.env.NEXT_PUBLIC_BUILD_ID` at HTML render time (may be empty). */
  expectedBuildId: string;
  /**
   * Build id reported by the currently-installed service worker. Use
   * `null` when no response arrived within the 1.5s timeout (distinct
   * from the empty string, which means "SW responded but has no id to
   * share" — we do NOT treat that as a stale signal; see rule 3).
   */
  swBuildId: string | null;
}

/** The inline script mirrors this function — see layout.tsx. */
export function shouldReloadForStaleSW({
  expectedBuildId,
  swBuildId,
}: KillSwitchInput): boolean {
  // Rule 2 — never reload under a dev/unknown build id. Prevents the
  // "every 60s a new version is available" loop that hit us before
  // EXPECTED was stabilised to the literal `dev-local`.
  if (!expectedBuildId || expectedBuildId === "dev-local") return false;

  // Rule 1 — SW silent past the timeout. The old SW has no handler for
  // GET_BUILD_ID; we assume stale and reload.
  if (swBuildId === null) return true;

  // Rule 3 — SW responded but gave us an empty buildId. Don't nuke on
  // this alone; wait for a real id before invalidating caches.
  if (swBuildId === "") return false;

  // Rules 4 + 5 — match → keep, mismatch → reload.
  return expectedBuildId !== swBuildId;
}
