import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { captureServerError } from "@/lib/sentry-capture";
import { safeEqual } from "@/lib/security/timing-safe";
import { sendZohoEmail } from "@/lib/email/zoho";
import { WATCH_ALERT_TO } from "@/lib/db-health-watch";
import {
  WATCH_WINDOW_MS,
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
 * GET /api/cron/checkout-failure-watch (LX-26, UX-ACC-56), every 15 minutes
 * (vercel.json, a-fo-03).
 *
 * Reads the last 24 hours of payment_events and emails the founder when
 * checkout failures pass 5 percent, a plan id is not configured, or a paid
 * webhook could not be tied to a learner. Rule: src/lib/checkout-failure-rate.ts.
 * a-fo-03: also lists `whop_revoke_unmatched` user_events rows created since
 * the previous run (a refund or chargeback that matched no subscription), and
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
        .select("created_at,event_data")
        .eq("event_type", "whop_revoke_unmatched")
        .gte("created_at", new Date(now - WATCH_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(REVOKE_LIMIT),
    ]);
    if (payments.error) throw new Error(payments.error.message);

    // A failed refund read never hides a payment alert: it is reported instead.
    const notes: string[] = [];
    let revokeReadFailed = false;
    if (revokeRead.error) {
      revokeReadFailed = true;
      captureServerError(new Error(`revoke_unmatched read failed: ${revokeRead.error.message}`), { route: "/api/cron/checkout-failure-watch" });
      notes.push("The unmatched-refund check could not read user_events this run; check /admin/payments by hand.");
    }
    const revokes = revokeUnmatchedLines((revokeRead.data ?? []) as RevokeUnmatchedRow[]);
    if (revokes.length >= REVOKE_LIMIT) notes.push(`Showing the newest ${REVOKE_LIMIT}; there may be more.`);

    const result = evaluateCheckoutWatch((payments.data ?? []) as WatchEvent[], now);
    if (!result.alert && revokes.length === 0) {
      return NextResponse.json({ ok: true, alert: false, attempts24h: result.attempts24h, failed24h: result.failed24h, revokeUnmatched: 0, revokeReadFailed });
    }

    const sent = await sendZohoEmail({ to: WATCH_ALERT_TO, ...checkoutWatchEmail(result, revokes, notes) });
    if (!sent.ok) {
      captureServerError(new Error(`checkout watch mail not sent: ${sent.reason}`), { route: "/api/cron/checkout-failure-watch" });
      return NextResponse.json({ ok: false, alert: true, sent: false, error: sent.reason }, { status: 503 });
    }
    return NextResponse.json({ ok: true, alert: true, sent: true, triggers: result.triggers, revokeUnmatched: revokes.length, revokeReadFailed });
  } catch (err) {
    captureServerError(err, { route: "/api/cron/checkout-failure-watch" });
    return NextResponse.json({ ok: false, error: "watch_failed" }, { status: 500 });
  }
}
