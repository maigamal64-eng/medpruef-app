import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { captureServerError } from "@/lib/sentry-capture";
import { safeEqual } from "@/lib/security/timing-safe";
import { sendZohoEmail } from "@/lib/email/zoho";
import { WATCH_ALERT_TO } from "@/lib/db-health-watch";
import { claimOnce, peekRecord } from "@/lib/data-cache";
import {
  checkoutWatchEmail,
  evaluateCheckoutWatch,
  revokeUnmatchedLines,
  type RevokeUnmatchedRow,
  type WatchEvent,
} from "@/lib/checkout-failure-rate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** At most this many unmatched refunds are listed per run (read-only, index on created_at). */
const REVOKE_LIMIT = 20;
/**
 * Refund rows are read over the last hour (four runs), not just the last 15
 * minutes, so a late or skipped cron run never loses one; each row is mailed
 * once, remembered by id in the Data Cache after a successful send (plus this
 * instance's memory where no shared cache exists).
 */
const REVOKE_LOOKBACK_MS = 60 * 60_000;
const mailedLocally = new Set<string>();
const mailedKey = (id: string) => ["checkout-watch-v1", "revoke", id];

async function alreadyMailed(id: string): Promise<boolean> {
  return mailedLocally.has(id) || (await peekRecord(mailedKey(id))) !== null;
}

/** Test seam. */
export function __resetMailedRevokes(): void {
  mailedLocally.clear();
}

/**
 * GET /api/cron/checkout-failure-watch (LX-26, UX-ACC-56), every 15 minutes
 * (vercel.json, a-fo-03).
 *
 * Reads the last 24 hours of payment_events and emails the founder when
 * checkout failures pass 5 percent, a plan id is not configured, or a paid
 * webhook could not be tied to a learner. Rule: src/lib/checkout-failure-rate.ts.
 * a-fo-03: also lists `whop_revoke_unmatched` user_events rows not mailed yet
 * (a refund or chargeback that matched no subscription; see REVOKE_LOOKBACK_MS), and
 * pages by email to user-b7e46e80@example.com (our own mailbox, direct Zoho like
 * db-health-watch) instead of the ops Telegram bot.
 *
 * Auth: Bearer CRON_SECRET, constant-time compare, fail closed.
 * Flag: CHECKOUT_ALERT_ENABLED (default OFF): when off the route evaluates
 * nothing and sends nothing.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (process.env.CHECKOUT_ALERT_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "disabled" });

  try {
    const now = Date.now();
    const sb = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
    const [payments, revokeRead] = await Promise.all([
      sb
        .from("payment_events")
        .select("event,reason,created_at,user_id")
        .gte("created_at", new Date(now - 24 * 3_600_000).toISOString())
        .in("event", ["checkout_session_created", "checkout_failed", "checkout_redirected", "grant_succeeded", "grant_failed"])
        .order("created_at", { ascending: false })
        .limit(5000),
      sb
        .from("user_events")
        .select("id,created_at,event_data")
        .eq("event_type", "whop_revoke_unmatched")
        .gte("created_at", new Date(now - REVOKE_LOOKBACK_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(REVOKE_LIMIT),
    ]);
    // A failed read on one side never hides the other side's alert: it is reported instead.
    const notes: string[] = [];
    const paymentsReadFailed = Boolean(payments.error);
    if (payments.error) {
      captureServerError(new Error(`payment_events read failed: ${payments.error.message}`), { route: "/api/cron/checkout-failure-watch" });
      notes.push("The payment checks could not read payment_events this run; check /admin/payments by hand.");
    }
    let revokeReadFailed = false;
    if (revokeRead.error) {
      revokeReadFailed = true;
      captureServerError(new Error(`revoke_unmatched read failed: ${revokeRead.error.message}`), { route: "/api/cron/checkout-failure-watch" });
      notes.push("The unmatched-refund check could not read user_events this run; check /admin/payments by hand.");
    }
    const read = (revokeRead.data ?? []) as Array<RevokeUnmatchedRow & { id: string | number }>;
    if (read.length >= REVOKE_LIMIT) notes.push(`Read the newest ${REVOKE_LIMIT} of the last hour; there may be more.`);
    const fresh: typeof read = [];
    for (const row of read) if (!(await alreadyMailed(String(row.id)).catch(() => false))) fresh.push(row);
    const revokes = revokeUnmatchedLines(fresh);

    const result = paymentsReadFailed ? null : evaluateCheckoutWatch((payments.data ?? []) as WatchEvent[], now);
    const failureStatus = paymentsReadFailed ? 500 : 200;
    if (!result?.alert && revokes.length === 0) {
      if (paymentsReadFailed) return NextResponse.json({ ok: false, error: "watch_failed", revokeUnmatched: 0, revokeReadFailed }, { status: 500 });
      return NextResponse.json({ ok: true, alert: false, attempts24h: result?.attempts24h ?? 0, failed24h: result?.failed24h ?? 0, revokeUnmatched: 0, revokeReadFailed });
    }

    const sent = await sendZohoEmail({ to: WATCH_ALERT_TO, ...checkoutWatchEmail(result, revokes, notes) });
    if (!sent.ok) {
      captureServerError(new Error(`checkout watch mail not sent: ${sent.reason}`), { route: "/api/cron/checkout-failure-watch" });
      return NextResponse.json({ ok: false, alert: true, sent: false, error: sent.reason }, { status: 503 });
    }
    for (const row of fresh) {
      mailedLocally.add(String(row.id));
      await claimOnce(mailedKey(String(row.id)), { at: now }).catch(() => undefined);
    }
    return NextResponse.json(
      { ok: !paymentsReadFailed, alert: true, sent: true, triggers: result?.triggers ?? [], revokeUnmatched: revokes.length, revokeReadFailed, paymentsReadFailed },
      { status: failureStatus },
    );
  } catch (err) {
    captureServerError(err, { route: "/api/cron/checkout-failure-watch" });
    return NextResponse.json({ ok: false, error: "watch_failed" }, { status: 500 });
  }
}
