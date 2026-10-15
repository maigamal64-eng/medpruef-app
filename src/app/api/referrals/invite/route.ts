import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { buildReferralLink } from "@/lib/referrals";
import { ensureReferralCode } from "@/lib/referral-code-server";
import { referralMentorCreditsOffered } from "@/lib/referral-mentor-credits";
import { isReferralExamRewardEnabled } from "@/lib/referral-exam-reward";
import { REFERRAL_CARD_WINDOW_DAYS, referralCardEligible, referralSurfaceEnabled, referralSurfaceFlag } from "@/lib/referral-surface";
import { activeDaysInWindow, shiftDay, viennaDay } from "@/lib/home-study-core";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Answers read for the card window; a learner past it in 14 days is active on 3+ days or capped low (never shown wrongly). */
const CARD_ROW_CAP = 2000;
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/referrals/invite (a-referral-surface)
 *
 * The signed learner's personal invite for the referral surfaces. Clients ask
 * only when /api/auth/me says `referral_surface`. Answers
 * `{ enabled: false }` (no further read, no code minted; with the flag or the
 * exam reward off not even the session read) unless
 * REFERRAL_SURFACE_ENABLED is "true", the account is enrolled in the referral
 * program (users.referrals_enabled) and the exam reward is live (the invite
 * text states it). Otherwise `{ enabled: true, link, mentorCredits }`, where
 * mentorCredits is the credit amount only while the mentor credit program is
 * on and the mentor is open beyond the beta list, else null.
 * `?card=1` adds `card: { activeDays14, eligible }` from the caller's own
 * answer_history (Vienna days, 14-day window); only the Home card asks.
 */
async function handleGET(req: NextRequest) {
  // Off: answer before the session check, so the switch costs no database read.
  if (!referralSurfaceFlag(process.env) || !isReferralExamRewardEnabled()) {
    return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  }
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const gate = checkRateLimit({ key: rateKey("referral-invite", userId), limit: 30, windowMs: 60_000 });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec), ...NO_STORE } });
  }

  const enabled = referralSurfaceEnabled({
    flag: true,
    referralsEnabled: guard.profile?.referralsEnabled === true,
    examRewardEnabled: true,
  });
  if (!enabled) return NextResponse.json({ enabled: false }, { headers: NO_STORE });

  const sb = getServiceClient();
  const { data: me, error: meErr } = await sb.from("users").select("referral_code").eq("id", userId).maybeSingle();
  if (meErr) throw meErr;
  if (!me) return NextResponse.json({ error: "User lookup failed" }, { status: 500, headers: NO_STORE });

  const ensured = await ensureReferralCode(sb, userId, me.referral_code as string | null);
  if (!ensured.ok) {
    if (ensured.reason === "update_failed") console.error("[referrals/invite] code update", ensured.error);
    return NextResponse.json({ error: "Could not prepare the referral link" }, { status: 500, headers: NO_STORE });
  }

  const body: {
    enabled: true;
    link: string;
    mentorCredits: number | null;
    card?: { activeDays14: number; eligible: boolean };
  } = { enabled: true, link: buildReferralLink(ensured.code), mentorCredits: referralMentorCreditsOffered() };

  if (req.nextUrl.searchParams.get("card") === "1") {
    const now = new Date();
    const since = new Date(Date.parse(`${shiftDay(viennaDay(now), -REFERRAL_CARD_WINDOW_DAYS)}T00:00:00Z`)).toISOString();
    const { data: rows, error } = await sb.from("answer_history").select("created_at").eq("user_id", userId)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(CARD_ROW_CAP);
    if (error) throw error;
    const activeDays14 = activeDaysInWindow((rows ?? []).map((r) => r.created_at as string), now, REFERRAL_CARD_WINDOW_DAYS);
    body.card = { activeDays14, eligible: referralCardEligible(activeDays14) };
  }

  return NextResponse.json(body, { headers: NO_STORE });
}

export const GET = withDbUnavailable(handleGET);
