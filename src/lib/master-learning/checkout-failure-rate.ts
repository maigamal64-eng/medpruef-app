/**
 * Checkout failure watch (LX-26-R). Pure decision plus an injectable sender.
 * The cron route (draft in handover) reads payment_events rows and calls this;
 * nothing here reads the clock, the database or the environment on its own.
 *
 * Alert rule: failed / created above RATE_THRESHOLD over at least MIN_SESSIONS
 * created sessions in the window, or any plan_not_configured in the last hour.
 * Flag CHECKOUT_ALERT_ENABLED (default OFF): with the flag off nothing is sent.
 */
import { timingSafeEqual } from "node:crypto";

export const RATE_THRESHOLD = 0.05;
export const MIN_SESSIONS = 5;
export const WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

export interface CheckoutEventRow {
  event: string;
  reason?: string | null;
  createdAt: string;
}

export interface FailureWatchResult {
  created: number;
  failed: number;
  rate: number | null;
  rateAlert: boolean;
  planNotConfiguredLastHour: number;
  alert: boolean;
  reasons: Record<string, number>;
}

export function evaluateCheckoutFailureRate(
  rows: readonly CheckoutEventRow[],
  opts: { now: Date; windowHours?: number; threshold?: number; minSessions?: number },
): FailureWatchResult {
  const windowMs = (opts.windowHours ?? WINDOW_HOURS) * HOUR_MS;
  const threshold = opts.threshold ?? RATE_THRESHOLD;
  const minSessions = opts.minSessions ?? MIN_SESSIONS;
  const now = opts.now.getTime();
  let created = 0;
  let failed = 0;
  let planNotConfiguredLastHour = 0;
  const reasons: Record<string, number> = {};
  for (const r of rows) {
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t) || t > now) continue;
    if (now - t <= windowMs) {
      if (r.event === "checkout_session_created") created += 1;
      if (r.event === "checkout_failed") {
        failed += 1;
        const key = r.reason || "unknown";
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    }
    if (r.event === "checkout_failed" && r.reason === "plan_not_configured" && now - t <= HOUR_MS) {
      planNotConfiguredLastHour += 1;
    }
  }
  const rate = created === 0 ? null : failed / created;
  const rateAlert = created >= minSessions && rate !== null && rate > threshold;
  return {
    created,
    failed,
    rate,
    rateAlert,
    planNotConfiguredLastHour,
    alert: rateAlert || planNotConfiguredLastHour > 0,
    reasons,
  };
}

export function alertMessage(r: FailureWatchResult): string {
  const pct = r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(1)}%`;
  const parts = [`[MedPruef] Checkout failures: ${r.failed} failed of ${r.created} created in 24h (${pct}).`];
  if (r.planNotConfiguredLastHour > 0) parts.push(`plan_not_configured in the last hour: ${r.planNotConfiguredLastHour}.`);
  const top = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) parts.push(`Top reasons: ${top.map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  return parts.join(" ");
}

/**
 * Sends only when the flag is on and the evaluation is an alert. The sender is
 * injected (track-A passes the Telegram helper), so the flag-off path makes
 * zero calls by construction.
 */
export async function maybeSendAlert(
  result: FailureWatchResult,
  deps: { enabled: boolean; send: (text: string) => Promise<unknown> },
): Promise<{ sent: boolean; reason: "flag_off" | "no_alert" | "sent" }> {
  if (!deps.enabled) return { sent: false, reason: "flag_off" };
  if (!result.alert) return { sent: false, reason: "no_alert" };
  await deps.send(alertMessage(result));
  return { sent: true, reason: "sent" };
}

/** Constant-time compare of a Bearer header against the cron secret. */
export function isAuthorizedCron(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!authorization || !secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authorization);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}
