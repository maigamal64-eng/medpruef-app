import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

async function handleGET(req: NextRequest) {
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
        // ATOMIC + idempotent bump (B-09 race fix, 2026-06-23).
        //
        // The home page fires this GET ~6x concurrently on a single
        // load. The old read-modify-write (`session_count + 1` written
        // back unconditionally) let all 6 win the >=30-min check and
        // each increment the counter — over-counting the session and
        // flipping which announcement surface the gate elects.
        //
        // The fix is a single conditional UPDATE guarded by a TIME
        // PREDICATE: only rows whose last_session_at is still older than
        // the cutoff get updated. The first writer flips last_session_at
        // to now(), which immediately fails the predicate for every
        // other concurrent writer — so the losers match 0 rows and the
        // stale `row.session_count + 1` literal can only ever be applied
        // once. (Supabase JS can't express `col = col + 1` or an
        // interval in the WHERE, but it doesn't need to: the predicate
        // alone serialises the bump. Same pattern as questions/route.ts.)
        const nowIso = new Date().toISOString();
        const cutoffIso = new Date(
          Date.now() - SESSION_GAP_MINUTES * 60_000,
        ).toISOString();

        const { data: bumped, error: updErr } = await sb
          .from("user_announcements")
          .update({
            session_count: (row.session_count as number) + 1,
            last_session_at: nowIso,
          })
          .eq("user_id", userId)
          .or(`last_session_at.is.null,last_session_at.lt.${cutoffIso}`)
          .select("*")
          .maybeSingle();

        if (updErr) {
          captureServerError(updErr, {
            route: "/api/announcements/state",
            userId,
            phase: "bump-session",
          });
          // Fall through with the stale row — gate still works.
        } else if (bumped) {
          // We won the race — `bumped` already has the incremented count.
          row = bumped;
        } else {
          // We lost the race: a concurrent request bumped first, so our
          // conditional UPDATE matched 0 rows. Re-read the row so the
          // returned sessionCount reflects the winner's value rather
          // than our stale (off-by-one) snapshot.
          const { data: fresh, error: reReadErr } = await sb
            .from("user_announcements")
            .select("*")
            .eq("user_id", userId)
            .maybeSingle();
          if (!reReadErr && fresh) {
            row = fresh;
          }
          // If the re-read fails, fall through with the stale row — the
          // gate still works, just one session behind for this response.
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

export const GET = withDbUnavailable(handleGET);
