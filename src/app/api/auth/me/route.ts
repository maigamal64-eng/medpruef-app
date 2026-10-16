import { NextRequest, NextResponse } from "next/server";
import { referralSurfaceEnabled, referralSurfaceFlag } from "@/lib/referral-surface";
import { activationEnabled } from "@/lib/activation/rules";
import { trialEndCardEnabled } from "@/lib/trial-end/flag";
import { homeCramCardEnabled } from "@/lib/home-cram-card/flag";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { isReferralExamRewardEnabled } from "@/lib/referral-exam-reward";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { loadStudySnapshot } from "@/lib/home-study-server";
import { dbUnavailableResponse, withDbUnavailable } from "@/lib/db-unavailable-route";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { ensureReverseTrial, type ReverseTrialState } from "@/lib/pricing-v2/reverse-trial-server";
import { seedSeatsFlag, seedSeatsReady } from "@/lib/seed-seats";
import { seatOnlyAccess } from "@/lib/seed-seats/server";
import { emailConfirmEnabled, EMAIL_CONFIRM_WINDOW_DAYS } from "@/lib/email-confirm/flag";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/auth/me
 *
 * Returns the authenticated user's *current* tier + role + email_status
 * + language_code from a fresh DB read (the guard's own lookup; one users
 * read per call since a-db-relief-1). Source of truth for any client
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
type MeRow = {
  id: string;
  tier: "free" | "pro" | "admin" | null;
  tier_expires_at: string | null;
  role: "user" | "admin" | null;
  email_status: "valid" | "bounced" | "unverified" | null;
  language_code: string | null;
  onboarding_completed_at: string | null;
  referrals_enabled: boolean | null;
};

function youngAccount(createdAt: string | null): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && t >= Date.now() - EMAIL_CONFIRM_WINDOW_DAYS * 86_400_000;
}

async function handleGET(req: NextRequest) {
  // a-db-relief-1: the guard's own users lookup already carries every field
  // this route returns, so a normal call reads the users row ONCE (it was
  // two reads, the largest share of users statements on the database).
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  try {
    const sb = getServiceClient();
    let data: MeRow | null;
    if (guard.profile) {
      data = {
        id: guard.userId,
        tier: guard.tier,
        tier_expires_at: guard.tierExpiresAt,
        role: guard.role,
        email_status: guard.profile.emailStatus,
        language_code: guard.profile.languageCode,
        onboarding_completed_at: guard.profile.onboardingCompletedAt,
        referrals_enabled: guard.profile.referralsEnabled,
      };
    } else {
      // A guard built without the profile (tests, older callers): read it.
      const read = await sb
        .from("users")
        .select(
          "id, tier, tier_expires_at, role, email_status, language_code, onboarding_completed_at, referrals_enabled",
        )
        .eq("id", guard.userId)
        .maybeSingle();
      if (read.error) {
        if (isDbUnavailable(read.error)) return dbUnavailableResponse();
        captureServerError(read.error, {
          route: "/api/auth/me",
          userId: guard.userId,
        });
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
      }
      data = (read.data as MeRow | null) ?? null;
    }
    if (!data) {
      // Shouldn't happen because requireUser already verified the row,
      // but defensive — return a 410 Gone so the client clears state.
      return NextResponse.json(
        { error: "User not found", code: "USER_GONE" },
        { status: 410 },
      );
    }

    // a-pricing-v2: the 3-day reverse trial starts here for a new verified
    // account (REVERSE_TRIAL_ENABLED, default off: no read at all while off;
    // older accounts are decided from the guard row without a read).
    let reverseTrial: ReverseTrialState | null = null;
    if (guard.profile) {
      reverseTrial = await ensureReverseTrial(sb, {
        userId: guard.userId,
        candidate: { createdAt: guard.profile.createdAt, role: data.role, tier: data.tier, tierExpiresAt: data.tier_expires_at },
        headers: req.headers,
      });
      if (reverseTrial.started && reverseTrial.endsAt) {
        data = { ...data, tier: "pro", tier_expires_at: reverseTrial.endsAt };
      }
    }
    // a-seed-seats: access that comes only from a seed seat is a buyer's on
    // /pricing (checkout already agrees). One read, only while seats are on
    // and only for a young account whose Pro ends within a seat's length.
    const seat = guard.profile && seedSeatsFlag() && !reverseTrial?.active
      ? await seatOnlyAccess(sb, guard.userId, { createdAt: guard.profile.createdAt, role: data.role, tier: data.tier, tierExpiresAt: data.tier_expires_at })
      : null;

    // UX-HOME-09 / LX-10: Home asks for its study snapshot on the same
    // request (?include=study) instead of a new endpoint. A failed snapshot
    // read never fails the identity read: the client keeps its cached values.
    let study: Awaited<ReturnType<typeof loadStudySnapshot>> | null | undefined;
    if (req.nextUrl.searchParams.get("include") === "study") {
      try {
        study = await loadStudySnapshot(sb, guard.userId, new Date(), guard.profile);
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
          // a-referral-surface: the referral invite surfaces may ask
          // /api/referrals/invite only when this is true (flag, program,
          // exam reward live), so nothing is fetched while they are off.
          referral_surface: referralSurfaceEnabled({
            flag: referralSurfaceFlag(process.env),
            referralsEnabled: (data.referrals_enabled as boolean | null) === true,
            examRewardEnabled: isReferralExamRewardEnabled(),
          }),
          // a-free-credit-hooks (a-release-int-2): env only, no read. The
          // Settings code and experience cards ask their routes only when
          // their flag is on, so Settings sends no extra request while off.
          // a-seed-seats: seat codes use the same code card, so it asks while either is on.
          campaign_codes: readFreeCreditConfig().campaignEnabled || seedSeatsReady(),
          experience_reward: readFreeCreditConfig().experienceEnabled,
          // a-activation-48h: env only, no read. The first-48-hours surfaces ask
          // /api/activation only when this is true.
          activation: activationEnabled(),
          // a-trial-end-decision: env only, no read. The trial-end card asks
          // /api/trial-end only when this is true.
          trial_end_card: trialEndCardEnabled(),
          // a-cram-card: env only, no read. The Home cram card asks /api/home/cram-card only when this is true.
          home_cram_card: homeCramCardEnabled(),
          // a-pricing-v2: present only while a reverse trial runs.
          ...(reverseTrial?.active ? { reverse_trial: { ends_at: reverseTrial.endsAt, started: reverseTrial.started } } : {}),
          ...(seat ? { seed_seat: { ends_at: seat.endsAt } } : {}),
          // a-email-confirm-trial: env and the guard row only, no read. Present
          // only while the step is on and the account is young enough for the
          // Home confirmation line, which asks /api/email-confirm only then.
          ...(emailConfirmEnabled() && guard.profile && data.role !== "admin" && youngAccount(guard.profile.createdAt) ? { email_confirm: true } : {}),
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

export const GET = withDbUnavailable(handleGET);
