import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { loadStudySnapshot } from "@/lib/home-study-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me
 *
 * Returns the authenticated user's *current* tier + role + email_status
 * + language_code from a fresh DB read. Source of truth for any client
 * code that needs to gate UI by tier.
 *
 * Why this exists (review-2026-04-26-A2):
 *   Obai (542fc71b) was granted Pro at 2026-04-25 20:34 UTC. His DB row
 *   shows tier='pro', tier_expires_at='2026-05-25', and the server-side
 *   quota gate honors it (his question count is unlimited). But the
 *   /settings Account section read tier from
 *   localStorage.medpruef_session.user.tier — which still said 'free'
 *   because the session blob was minted before the grant landed and
 *   nothing re-fetched.
 *
 *   PR #9's force-refresh-session bumps users.session_invalidated_at
 *   and sends REFRESH_REQUIRED on the next API call, which forces a
 *   re-login. But that's heavy-handed for "did your tier change?"
 *   This GET gives any component a lightweight, cache-buster, fresh
 *   tier read in <100 ms without disturbing the user.
 *
 * Caching:
 *   Cache-Control: no-store, no-cache, must-revalidate.
 *   The whole point is freshness; the route is cheap (single index lookup).
 *
 * Response shape:
 *   {
 *     user: {
 *       id: uuid,
 *       tier: 'free' | 'pro' | 'admin',
 *       tier_expires_at: ISO | null,
 *       role: 'user' | 'admin',
 *       email_status: 'valid' | 'bounced' | 'unverified' | null,
 *       language_code: 'de' | 'en' | null,
 *       onboarding_completed_at: ISO | null,
 *     },
 *     fetched_at: ISO
 *   }
 *
 * Auth: requireUser. The header `x-session-issued-at` is also honored
 * by requireUser; if the admin force-refreshed the session, this route
 * returns the same REFRESH_REQUIRED 401 every other guarded route does.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("users")
      .select(
        "id, tier, tier_expires_at, role, email_status, language_code, onboarding_completed_at, referrals_enabled",
      )
      .eq("id", guard.userId)
      .maybeSingle();

    if (error) {
      captureServerError(error, {
        route: "/api/auth/me",
        userId: guard.userId,
      });
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    if (!data) {
      // Shouldn't happen because requireUser already verified the row,
      // but defensive — return a 410 Gone so the client clears state.
      return NextResponse.json(
        { error: "User not found", code: "USER_GONE" },
        { status: 410 },
      );
    }

    // UX-HOME-09 / LX-10: Home asks for its study snapshot on the same
    // request (?include=study) instead of a new endpoint. A failed snapshot
    // read never fails the identity read: the client keeps its cached values.
    let study: Awaited<ReturnType<typeof loadStudySnapshot>> | null | undefined;
    if (req.nextUrl.searchParams.get("include") === "study") {
      try {
        study = await loadStudySnapshot(sb, guard.userId);
      } catch (err) {
        captureServerError(err, { route: "/api/auth/me", phase: "study" });
        study = null;
      }
    }

    return NextResponse.json(
      {
        ...(study !== undefined ? { study } : {}),
        user: {
          id: data.id as string,
          tier: (data.tier as "free" | "pro" | "admin") ?? "free",
          tier_expires_at: (data.tier_expires_at as string | null) ?? null,
          role: (data.role as "user" | "admin") ?? "user",
          email_status:
            (data.email_status as "valid" | "bounced" | "unverified" | null) ?? null,
          language_code: (data.language_code as "de" | "en" | null) ?? null,
          onboarding_completed_at:
            (data.onboarding_completed_at as string | null) ?? null,
          // Invite-only referral program (2026-06-25): only flagged
          // accounts see/use the referral UI + can earn. Default false.
          referrals_enabled: (data.referrals_enabled as boolean | null) ?? false,
        },
        fetched_at: new Date().toISOString(),
      },
      {
        headers: {
          // Defeat browser caching, intermediate proxies, and the
          // service worker. The whole point of this route is freshness.
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  } catch (err) {
    captureServerError(err, { route: "/api/auth/me" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
