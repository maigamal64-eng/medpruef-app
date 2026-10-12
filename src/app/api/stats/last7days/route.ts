import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/stats/last7days
 *
 * Returns real per-day answer activity for the last 7 days for the
 * authenticated user. Dates are bucketed by the user's Austrian /
 * Vienna local day (Europe/Vienna) so the last cell in the response
 * is "today" regardless of where the request actually originates.
 *
 * Response shape:
 *   {
 *     days: Array<{
 *       date: string;        // YYYY-MM-DD in Europe/Vienna
 *       answered: number;    // questions answered that day
 *       correct: number;     // of those, how many were correct
 *       xpEarned: number;    // sum of answer_history.xp_earned
 *     }>
 *   }
 *
 * Exactly 7 entries, oldest first. Days with no activity are zero-filled
 * so the widget can render a full 7-cell strip without gap handling.
 *
 * Auth: requireUser — 401 when the user can't be resolved from the
 * session header. The StreakWidget falls back to its streak-count
 * strip in that case, so there's no UX cliff for guests.
 *
 * Agent: DD-09 (Agent 4 in the MPDS v2 parallel rollout).
 */

const VIENNA_TZ = "Europe/Vienna";

/**
 * Convert any UTC timestamp string to a YYYY-MM-DD string using
 * Europe/Vienna local calendar. `Intl.DateTimeFormat('sv-SE', …)`
 * returns ISO-style YYYY-MM-DD without needing any npm deps.
 */
function viennaDate(utc: string | number | Date): string {
  const d = utc instanceof Date ? utc : new Date(utc);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: VIENNA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Build the ordered list of the last 7 Vienna-local days, oldest first.
 * Uses the "now" moment as "today" so the last entry is today and the
 * first is 6 days ago.
 */
function last7ViennaDates(now: Date = new Date()): string[] {
  const out: string[] = [];
  // Walk 6..0 days ago.
  for (let offset = 6; offset >= 0; offset--) {
    // Subtract `offset * 24h` from "now" and format in Vienna TZ.
    // Using 24h-based subtraction is correct for bucketing — DST
    // shifts can make a calendar day 23h or 25h long, but our
    // windowing is "the Vienna local day N days ago" which the
    // formatter handles by re-deriving the local date after the
    // subtraction. 24h is close enough that we never miss a day.
    const d = new Date(now.getTime() - offset * 86_400_000);
    out.push(viennaDate(d));
  }
  return out;
}

async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sb = getServiceClient();

    // Use "now" in UTC-ms for the lower bound. We want "7 Vienna-local
    // days worth of data", which is at most ~7*24h + DST slack. Adding
    // a 48h buffer on the backend (9 days instead of 7) makes sure we
    // never drop an edge event near midnight Vienna time due to UTC/TZ
    // skew — we filter down to exactly 7 buckets after grouping.
    const now = new Date();
    const lowerBoundMs = now.getTime() - 9 * 86_400_000;
    const lowerBoundIso = new Date(lowerBoundMs).toISOString();

    const { data: rows, error } = await sb
      .from("answer_history")
      .select("created_at, is_correct, xp_earned")
      .eq("user_id", userId)
      .gte("created_at", lowerBoundIso)
      .order("created_at", { ascending: true })
      .limit(5000);

    if (error) {
      console.error("[stats/last7days] query error:", error);
      // Try Sentry in a safe, optional way — don't let a missing
      // dependency break the route.
      try {
        const Sentry = await import("@sentry/nextjs");
        Sentry.captureException(error);
      } catch {
        /* noop */
      }
      // Don't leak DB error details to the client.
      return NextResponse.json(
        { days: [], error: "Failed to load activity" },
        { status: 500 }
      );
    }

    // Group by Vienna-local date.
    const bucket: Record<
      string,
      { answered: number; correct: number; xpEarned: number }
    > = {};
    for (const row of rows || []) {
      if (!row?.created_at) continue;
      const day = viennaDate(row.created_at as string);
      if (!bucket[day]) bucket[day] = { answered: 0, correct: 0, xpEarned: 0 };
      bucket[day].answered += 1;
      if (row.is_correct) bucket[day].correct += 1;
      if (typeof row.xp_earned === "number") {
        bucket[day].xpEarned += row.xp_earned;
      }
    }

    const windowDays = last7ViennaDates(now);
    const days = windowDays.map(date => {
      const b = bucket[date];
      return {
        date,
        answered: b?.answered ?? 0,
        correct: b?.correct ?? 0,
        xpEarned: b?.xpEarned ?? 0,
      };
    });

    return NextResponse.json({ days });
  } catch (err) {
    console.error("[stats/last7days] internal error:", err);
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(err);
    } catch {
      /* noop */
    }
    return NextResponse.json(
      { days: [], error: "Internal error" },
      { status: 500 }
    );
  }
}

export const GET = withDbUnavailable(handleGET);
