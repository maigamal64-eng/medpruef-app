import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/user/onboarding-complete
 *
 * Stamps users.onboarding_completed_at = now() and persists the snapshot
 * of stated preferences (exam, exam_date, daily_goal, language) into
 * users.onboarding_data jsonb.
 *
 * Idempotent — re-posting after the user is already marked complete is
 * a no-op (we keep the original completed_at to preserve analytics
 * accuracy).
 *
 * Body shape (every field optional, all merged into onboarding_data):
 *   {
 *     examSource?: "kenntnispruefung" | "kmp_innsbruck" | "pharma",
 *     examDate?:   string (YYYY-MM-DD) | "not_planned" | null,
 *     dailyGoal?:  number,
 *     language?:   "de" | "en",
 *   }
 *
 * Auth: requireUser. The previous client-only persistence was
 * cross-device-broken — see review-2026-04-26-A2.
 */
async function handlePOST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      // No body is fine — the user can also just hit completion without
      // any data (e.g. mid-flow skip). We still stamp completed_at.
    }

    const sb = getServiceClient();

    // Idempotency: if the user is already marked complete, return early
    // with their existing state (don't overwrite the original timestamp).
    const { data: current, error: readErr } = await sb
      .from("users")
      .select("onboarding_completed_at")
      .eq("id", guard.userId)
      .maybeSingle();
    if (readErr) {
      captureServerError(readErr, {
        route: "/api/user/onboarding-complete",
        phase: "read",
        userId: guard.userId,
      });
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    if (current?.onboarding_completed_at) {
      return NextResponse.json({
        ok: true,
        completed_at: current.onboarding_completed_at,
        already: true,
      });
    }

    const now = new Date().toISOString();
    const onboardingData: Record<string, unknown> = {
      examSource: typeof body.examSource === "string" ? body.examSource : null,
      examDate:
        typeof body.examDate === "string" || body.examDate === null
          ? body.examDate
          : null,
      dailyGoal: typeof body.dailyGoal === "number" ? body.dailyGoal : null,
      language: typeof body.language === "string" ? body.language : null,
      completedAt: now,
    };

    const { error: updErr } = await sb
      .from("users")
      .update({
        onboarding_completed_at: now,
        onboarding_data: onboardingData,
      })
      .eq("id", guard.userId);

    if (updErr) {
      captureServerError(updErr, {
        route: "/api/user/onboarding-complete",
        phase: "update",
        userId: guard.userId,
      });
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, completed_at: now, already: false });
  } catch (err) {
    captureServerError(err, { route: "/api/user/onboarding-complete" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const POST = withDbUnavailable(handlePOST);
