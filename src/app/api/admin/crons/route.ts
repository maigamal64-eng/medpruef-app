import { NextResponse } from "next/server";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { loadCronHealth } from "@/lib/admin/cron-health";
import { readMentorConfig } from "@/lib/mentor/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/crons (a19, ADM-12 B, UX-ADM-09).
 *
 * `jobs`: one row per scheduled job with its last run, read from the
 * evidence each job leaves (heartbeat events, the mentor job record,
 * cron_runs) and judged against its schedule (OK, Late, Overdue, Stuck,
 * Failed). `items`: cron_runs rows plus heartbeat rows of the last 48 hours.
 * A read that fails shows the job as "Could not read", never "No run".
 */
export const GET = adminRouteShell(
  async () => {
    let snapshot;
    try {
      snapshot = await loadCronHealth(getServiceClient(), new Date(), { mentorEnabled: readMentorConfig().enabled });
    } catch (error) {
      return adminErrorResponse(error, "/api/admin/crons");
    }
    // UX-ADM-34: the page prints "Showing N of M" instead of cutting silently.
    return NextResponse.json(
      { jobs: snapshot.jobs, items: snapshot.runs, total: snapshot.runs_total, window_hours: snapshot.window_hours },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
  { route: "/api/admin/crons" }
);
