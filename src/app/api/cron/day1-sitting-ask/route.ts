import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { cronAuthorized, noStore } from "@/lib/reminders/common";
import { day1AskDryRun, day1AskEnabled } from "@/lib/day1-ask/flag";
import { runDay1SittingAsk } from "@/lib/day1-ask/run";
import { sittingLinkEnabled, datesFrozen } from "@/lib/sitting-link/flag";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Hourly sweep behind DAY1_SITTING_ASK_ENABLED (default off): the one
 * onboarding mail per account (a-day1-sitting-ask). With the flag off it
 * answers {enabled:false} without a database read. DAY1_SITTING_ASK_DRY_RUN
 * (default on) turns the run into counts only. A live run also needs the
 * one-tap page itself on (SITTING_LINK_ENABLED) and the date-watch freeze
 * off, so no learner is mailed a link that answers 404 or hides the dates.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    Sentry.captureMessage("CRON_SECRET not set: /api/cron/day1-sitting-ask disabled", "error");
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 503, headers: noStore });
  }
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  if (!day1AskEnabled()) return NextResponse.json({ ok: true, enabled: false }, { headers: noStore });

  const dryRun = day1AskDryRun();
  if (!dryRun && (!sittingLinkEnabled() || datesFrozen())) {
    return NextResponse.json({ ok: true, enabled: true, dry_run: false, skipped: sittingLinkEnabled() ? "dates_frozen" : "sitting_link_disabled" }, { headers: noStore });
  }
  const sb = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
  const nowIso = new Date().toISOString();
  try {
    // Heartbeat for cron health (a real run only: a dry run writes nothing).
    if (!dryRun) await sb.from("user_events").insert({ user_id: "cron", event_type: "cron_day1_sitting_ask_heartbeat", event_data: { at: nowIso } });
  } catch { /* observability only */ }
  try {
    const result = await runDay1SittingAsk(sb, {
      dryRun,
      recordEvent: async (userId, eventType, data) => {
        try { await sb.from("user_events").insert({ user_id: userId, event_type: eventType, event_data: data }); }
        catch (err) { console.error(`[cron/day1-sitting-ask:${eventType}]`, err); }
      },
    });
    return NextResponse.json({ ok: true, enabled: true, ...result, ran_at: nowIso }, { headers: noStore });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "cron/day1-sitting-ask" } });
    return NextResponse.json({ error: "Run failed" }, { status: 500, headers: noStore });
  }
}
