import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServiceClient } from "@/lib/supabase";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { safeEqual } from "@/lib/security/timing-safe";
import { runTicketEndingReminders, runTicketProofCleanup } from "@/lib/pricing-v2/ticket-server";
import { runHalfYearRenewals } from "@/lib/pricing-v2/half-year-server";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily v2 offer upkeep (a-pricing-v2), bearer CRON_SECRET:
 *   1. delete Guarantee Ticket proof files 30 days after the decision
 *      (always, once the changeset exists: a privacy promise, not a feature)
 *   2. "your ticket ends in 30 days" (TICKET_REMINDER_EMAILS_ENABLED)
 *   3. 6-month plan: stop the renewal at Whop once the exam date passed
 *      (HALF_YEAR_AUTO_STOP_ENABLED, dry run unless
 *      HALF_YEAR_AUTO_STOP_DRY_RUN=false) and the 7-day renewal reminder
 *      (HALF_YEAR_REMINDER_EMAILS_ENABLED)
 * Each step runs on its own; one failing step never stops the others.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    Sentry.captureMessage("CRON_SECRET not set: /api/cron/pricing-v2 disabled", "error");
    return NextResponse.json({ error: "Cron secret not configured" }, { status: 503 });
  }
  if (!safeEqual(req.headers.get("authorization"), `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com";
  const out: Record<string, unknown> = {};
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      out[name] = await run();
    } catch (err) {
      captureServerError(err, { route: "/api/cron/pricing-v2", phase: name });
      out[name] = { error: true };
    }
  };
  await step("ticket_proof_cleanup", () => runTicketProofCleanup(sb));
  await step("ticket_reminders", () => runTicketEndingReminders(sb, site));
  await step("half_year", () => runHalfYearRenewals(sb));
  return NextResponse.json({ ok: true, ...out });
}
