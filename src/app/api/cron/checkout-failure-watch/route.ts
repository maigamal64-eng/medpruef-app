import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { captureServerError } from "@/lib/sentry-capture";
import { safeEqual } from "@/lib/security/timing-safe";
import { checkoutWatchMessage, evaluateCheckoutWatch, type WatchEvent } from "@/lib/checkout-failure-rate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Internal ops chat on the default [name] bot (workspace Telegram rule). Never a customer bot. */
const OPS_CHAT_ID = 0;

/**
 * GET /api/cron/checkout-failure-watch (LX-26, UX-ACC-56), every 15 minutes.
 *
 * Reads the last 24 hours of payment_events and pages the founder on the
 * internal ops bot when checkout failures pass 5 percent, a plan id is not
 * configured, or a paid webhook could not be tied to a learner. Rule and
 * message: src/lib/checkout-failure-rate.ts (counts only, no learner data).
 *
 * Auth: Bearer CRON_SECRET, constant-time compare, fail closed.
 * Flag: CHECKOUT_ALERT_ENABLED (default OFF): when off the route evaluates
 * nothing and sends nothing. The send uses TELEGRAM_OPS_FORWARD_TOKEN (the
 * internal ops bot), never TELEGRAM_BOT_TOKEN (@MedPruefBot is customer-facing).
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
    const { data, error } = await getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS })
      .from("payment_events")
      .select("event,reason,created_at,user_id")
      .gte("created_at", new Date(now - 24 * 3_600_000).toISOString())
      .in("event", ["checkout_session_created", "checkout_failed", "checkout_redirected", "grant_succeeded", "grant_failed"])
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);

    const result = evaluateCheckoutWatch((data ?? []) as WatchEvent[], now);
    if (!result.alert) return NextResponse.json({ ok: true, alert: false, attempts24h: result.attempts24h, failed24h: result.failed24h });

    const token = process.env.TELEGRAM_OPS_FORWARD_TOKEN;
    if (!token) {
      captureServerError(new Error(`checkout watch alert without an ops bot token: ${result.triggers.join(",")}`), { route: "/api/cron/checkout-failure-watch" });
      return NextResponse.json({ ok: false, alert: true, sent: false, error: "ops_token_not_configured" }, { status: 503 });
    }
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: OPS_CHAT_ID, text: checkoutWatchMessage(result) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`telegram send failed with ${response.status}`);
    return NextResponse.json({ ok: true, alert: true, sent: true, triggers: result.triggers });
  } catch (err) {
    captureServerError(err, { route: "/api/cron/checkout-failure-watch" });
    return NextResponse.json({ ok: false, error: "watch_failed" }, { status: 500 });
  }
}
