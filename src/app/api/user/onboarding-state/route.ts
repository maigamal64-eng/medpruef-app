import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/onboarding-state
 *
 * Returns the current user's server-side onboarding state. Used by the
 * `/` route to decide whether to show the onboarding modal even when
 * localStorage is fresh (new browser, incognito, cleared cache).
 *
 * Response:
 *   {
 *     completed_at: string | null   // ISO timestamp or null
 *     skipped_at:   string | null
 *     data:         object | null   // snapshot of stated prefs
 *   }
 *
 * Source-of-truth for whether onboarding has been completed lives in
 * users.onboarding_completed_at — see migration 20260426010000.
 *
 * review-2026-04-26-A2.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("users")
      .select("onboarding_completed_at, onboarding_skipped_at, onboarding_data")
      .eq("id", guard.userId)
      .maybeSingle();

    if (error) {
      captureServerError(error, {
        route: "/api/user/onboarding-state",
        phase: "select",
        userId: guard.userId,
      });
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    return NextResponse.json({
      completed_at: data?.onboarding_completed_at ?? null,
      skipped_at: data?.onboarding_skipped_at ?? null,
      data: data?.onboarding_data ?? null,
    });
  } catch (err) {
    captureServerError(err, { route: "/api/user/onboarding-state" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
