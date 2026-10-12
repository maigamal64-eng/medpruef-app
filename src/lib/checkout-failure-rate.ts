/**
 * Checkout failure watch (LX-26, UX-ACC-56): the pure rule behind the
 * 15-minute ops alert. Reads payment_events rows the cron already selected and decides
 * whether the founder is paged on the internal ops bot. No I/O here.
 *
 * Triggers (each one stateless, so the cron never needs a "sent" marker; a "run" is the
 * cron interval, WATCH_WINDOW_MS):
 *   - rate:      over the last 24 hours, failed checkouts exceed 5 percent of
 *                attempts (created + failed) with at least 5 attempts, and at
 *                least one failure is new since the previous run.
 *   - plan:      any `plan_not_configured` failure since the previous run.
 *   - unmatched: a paid webhook since the previous run that could not be tied
 *                to a learner (grant_failed with reason unmapped or db_error),
 *                so an untied payment pages within 15 minutes.
 * Context (never pages by itself): redirects 30 to 45 minutes old with no
 * grant for that learner since, so each stale redirect is counted once.
 *
 * `verified_payment_not_found` is a verify result, not a checkout failure, and
 * never counts. Messages carry counts and reasons only, never ids or emails.
 */
export interface WatchEvent {
  event: string;
  reason?: string | null;
  created_at: string;
  user_id?: string | null;
}

export const FAILURE_RATE_THRESHOLD = 0.05;
export const MIN_ATTEMPTS = 5;
const HOUR = 3_600_000;
/** Cron interval; every "since the previous run" window uses it. */
export const WATCH_WINDOW_MS = 15 * 60_000;
const NOT_A_FAILURE = new Set(["verified_payment_not_found"]);
const UNMATCHED_GRANT_REASONS = new Set(["unmapped", "db_error"]);

export interface WatchResult {
  alert: boolean;
  triggers: Array<"rate" | "plan" | "unmatched">;
  attempts24h: number;
  failed24h: number;
  rate24h: number;
  failuresByReason: Record<string, number>;
  planNotConfiguredNew: number;
  unmatchedNew: number;
  staleRedirects: number;
}

const at = (row: WatchEvent) => Date.parse(row.created_at);
const isFailure = (row: WatchEvent) => row.event === "checkout_failed" && !NOT_A_FAILURE.has(row.reason ?? "");

export function evaluateCheckoutWatch(events: readonly WatchEvent[], now: number = Date.now(), windowMs: number = WATCH_WINDOW_MS): WatchResult {
  const valid = events.filter((row) => Number.isFinite(at(row)) && at(row) <= now);
  const day = valid.filter((row) => now - at(row) < 24 * HOUR);
  const isNew = (row: WatchEvent) => now - at(row) < windowMs;

  const created = day.filter((row) => row.event === "checkout_session_created").length;
  const failures = day.filter(isFailure);
  const attempts = created + failures.length;
  const rate = attempts > 0 ? failures.length / attempts : 0;
  const failuresByReason: Record<string, number> = {};
  for (const row of failures) {
    const key = row.reason || "unknown";
    failuresByReason[key] = (failuresByReason[key] ?? 0) + 1;
  }

  const newFailure = failures.some(isNew);
  const planNotConfiguredNew = failures.filter((row) => row.reason === "plan_not_configured" && isNew(row)).length;
  const unmatchedNew = day.filter((row) => row.event === "grant_failed" && UNMATCHED_GRANT_REASONS.has(row.reason ?? "") && isNew(row)).length;

  const grants = valid.filter((row) => row.event === "grant_succeeded");
  const staleRedirects = valid.filter((row) => {
    if (row.event !== "checkout_redirected" || !row.user_id) return false;
    const age = now - at(row);
    if (age < 30 * 60_000 || age >= 30 * 60_000 + windowMs) return false;
    return !grants.some((grant) => grant.user_id === row.user_id && at(grant) >= at(row));
  }).length;

  const triggers: WatchResult["triggers"] = [];
  if (attempts >= MIN_ATTEMPTS && rate > FAILURE_RATE_THRESHOLD && newFailure) triggers.push("rate");
  if (planNotConfiguredNew > 0) triggers.push("plan");
  if (unmatchedNew > 0) triggers.push("unmatched");

  return {
    alert: triggers.length > 0,
    triggers,
    attempts24h: attempts,
    failed24h: failures.length,
    rate24h: rate,
    failuresByReason,
    planNotConfiguredNew,
    unmatchedNew,
    staleRedirects,
  };
}

/** Plain-text ops message for the internal bot. Counts only, no learner data. */
export function checkoutWatchMessage(result: WatchResult): string {
  const pct = Math.round(result.rate24h * 1000) / 10;
  const reasons = Object.entries(result.failuresByReason).map(([reason, n]) => `${reason} ${n}`).join(", ") || "none";
  const lines = [
    "[MedPrüf][checkout-watch]",
    `Triggers: ${result.triggers.join(", ")}`,
    `24h: ${result.failed24h} failed of ${result.attempts24h} attempts (${pct} %). Reasons: ${reasons}.`,
  ];
  if (result.planNotConfiguredNew) lines.push(`plan_not_configured since the last check: ${result.planNotConfiguredNew}. Check the WHOP_PLAN_* env.`);
  if (result.unmatchedNew) lines.push(`Paid webhooks not tied to a learner since the last check: ${result.unmatchedNew}. See /admin/payments, Unresolved payments.`);
  if (result.staleRedirects) lines.push(`Redirects 30 to 45 minutes old without a grant: ${result.staleRedirects}.`);
  return lines.join("\n");
}
