import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * POST /api/announcements/seen
 *
 * Records that the user has seen or dismissed one of the announcement
 * surfaces. Stamps the corresponding `*_at` column to now().
 *
 * Body:
 *   { surface: 'orientation_modal' | 'cohort_banner' | 'referral_floater' }
 *
 * The hook calls this when a surface is dismissed (× button) or
 * auto-closes after the user completed the interaction (e.g. clicking
 * "Weiterlernen" on the OrientationModal).
 *
 * Response 200: { ok: true, state: <same shape as /state response> }
 * Response 400: { error: 'invalid surface' }
 */

type Surface =
  | "orientation_modal"
  | "cohort_banner"
  | "referral_floater"
  // Cross-device gates added 2026-04-26 (review-2026-04-26-A3) so the
  // FeedbackWidget survey + WhatsNewModal don't re-fire on every fresh
  // browser. Cosmetic state stays localStorage-only.
  | "feedback_survey_shown"
  | "feedback_survey_dismissed"
  | "whats_new_seen";

const SURFACE_TO_COLUMN: Record<Surface, string> = {
  orientation_modal: "orientation_modal_seen_at",
  cohort_banner: "cohort_banner_dismissed_at",
  referral_floater: "referral_floater_dismissed_at",
  feedback_survey_shown: "feedback_survey_shown_at",
  feedback_survey_dismissed: "feedback_survey_dismissed_at",
  whats_new_seen: "whats_new_seen_at",
};

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  let body: { surface?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const surface = body?.surface as Surface | undefined;
  if (!surface || !(surface in SURFACE_TO_COLUMN)) {
    return NextResponse.json(
      {
        error:
          "Invalid surface — expected one of 'orientation_modal' | 'cohort_banner' | 'referral_floater' | 'feedback_survey_shown' | 'feedback_survey_dismissed' | 'whats_new_seen'",
      },
      { status: 400 }
    );
  }

  try {
    const sb = getServiceClient();
    const column = SURFACE_TO_COLUMN[surface];

    // Ensure a row exists (upsert semantics). Then stamp the column.
    // We use a SELECT → INSERT/UPDATE pattern rather than ON CONFLICT
    // because the column name is dynamic.
    const { data: existing } = await sb
      .from("user_announcements")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existing) {
      const { error: insErr } = await sb
        .from("user_announcements")
        .insert({ user_id: userId, [column]: new Date().toISOString() });
      if (insErr) {
        captureServerError(insErr, {
          route: "/api/announcements/seen",
          userId,
          surface,
          phase: "insert",
        });
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
    } else {
      const { error: updErr } = await sb
        .from("user_announcements")
        .update({ [column]: new Date().toISOString() })
        .eq("user_id", userId);
      if (updErr) {
        captureServerError(updErr, {
          route: "/api/announcements/seen",
          userId,
          surface,
          phase: "update",
        });
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
      }
    }

    // Return the updated state so the client can re-evaluate the gate
    // without a follow-up GET.
    const { data: row } = await sb
      .from("user_announcements")
      .select("*")
      .eq("user_id", userId)
      .single();

    return NextResponse.json({
      ok: true,
      state: row
        ? {
            userId,
            sessionCount: row.session_count as number,
            qsAnsweredTotal: row.qs_answered_total as number,
            orientationModalSeenAt: row.orientation_modal_seen_at as string | null,
            cohortBannerDismissedAt: row.cohort_banner_dismissed_at as string | null,
            referralFloaterDismissedAt: row.referral_floater_dismissed_at as string | null,
            feedbackSurveyShownAt: row.feedback_survey_shown_at as string | null,
            feedbackSurveyDismissedAt: row.feedback_survey_dismissed_at as string | null,
            whatsNewSeenAt: row.whats_new_seen_at as string | null,
            lastSessionAt: row.last_session_at as string,
          }
        : null,
    });
  } catch (err) {
    captureServerError(err, {
      route: "/api/announcements/seen",
      userId,
      surface,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
