import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * GET /api/announcements/state
 *
 * Returns the authenticated user's `user_announcements` row, creating
 * it on first hit. Also bumps `session_count` if `last_session_at`
 * is more than SESSION_GAP_MINUTES ago — that's how we detect "this
 * is session N, returning visit".
 *
 * Request: no body. Auth via `x-user-id` header (same pattern as
 * every other user-facing API).
 *
 * Response 200:
 *   {
 *     state: {
 *       userId,
 *       sessionCount,
 *       qsAnsweredTotal,
 *       orientationModalSeenAt,          // ISO string or null
 *       cohortBannerDismissedAt,         // ISO string or null
 *       referralFloaterDismissedAt,      // ISO string or null
 *       lastSessionAt,                   // ISO string
 *     }
 *   }
 *
 * The hook `useAnnouncementGate` calls this once per page load and
 * the five surface components (GuestMigrationBanner excluded — it's
 * self-gated by the guest check) read the result.
 */

/** A new "session" starts when the user returns after >= 30 min idle. */
const SESSION_GAP_MINUTES = 30;

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sb = getServiceClient();

    // Upsert the row on first access. The backfill migration should
    // have seeded every pre-existing user, but defense in depth — a
    // user created after the migration ran needs a row too.
    const { data: existing, error: selErr } = await sb
      .from("user_announcements")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) {
      captureServerError(selErr, {
        route: "/api/announcements/state",
        userId,
        phase: "select",
      });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    let row = existing;

    if (!row) {
      const { data: inserted, error: insErr } = await sb
        .from("user_announcements")
        .insert({ user_id: userId })
        .select("*")
        .single();
      if (insErr || !inserted) {
        captureServerError(insErr, {
          route: "/api/announcements/state",
          userId,
          phase: "insert",
        });
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
      row = inserted;
    } else {
      // Bump session_count if enough time has passed since
      // last_session_at. This is the "new session" detection heuristic
      // and it's idempotent for rapid reloads.
      const lastSessionAt = new Date(row.last_session_at as string);
      const minutesSince = (Date.now() - lastSessionAt.getTime()) / 60_000;

      if (minutesSince >= SESSION_GAP_MINUTES) {
        const { data: bumped, error: updErr } = await sb
          .from("user_announcements")
          .update({
            session_count: (row.session_count as number) + 1,
            last_session_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .select("*")
          .single();
        if (updErr) {
          captureServerError(updErr, {
            route: "/api/announcements/state",
            userId,
            phase: "bump-session",
          });
          // Fall through with the stale row — gate still works.
        } else if (bumped) {
          row = bumped;
        }
      }
    }

    return NextResponse.json({
      state: {
        userId,
        sessionCount: row.session_count as number,
        qsAnsweredTotal: row.qs_answered_total as number,
        orientationModalSeenAt: row.orientation_modal_seen_at as string | null,
        cohortBannerDismissedAt: row.cohort_banner_dismissed_at as string | null,
        referralFloaterDismissedAt: row.referral_floater_dismissed_at as string | null,
        // Cross-device gates added 2026-04-26 (review-2026-04-26-A3)
        // for the FeedbackWidget survey + WhatsNewModal so they don't
        // re-fire on every fresh browser. Cosmetic state stays
        // localStorage-only.
        feedbackSurveyShownAt: row.feedback_survey_shown_at as string | null,
        feedbackSurveyDismissedAt: row.feedback_survey_dismissed_at as string | null,
        whatsNewSeenAt: row.whats_new_seen_at as string | null,
        lastSessionAt: row.last_session_at as string,
      },
    });
  } catch (err) {
    captureServerError(err, { route: "/api/announcements/state", userId });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
