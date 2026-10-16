import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { readCampaignStatus, readRedemption } from "@/lib/mentor/credits/campaign";
import { SEAT_MAX_ACCOUNT_AGE_DAYS, seedSeatsReady } from "@/lib/seed-seats";
import { readSeatEnd, readSeatStatus } from "@/lib/seed-seats/server";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/mentor/campaign/status: may this account still redeem a code?
 * {enabled:false} while MENTOR_CAMPAIGN_CODES_ENABLED and seed seats are
 * both off (no read). Otherwise {enabled, eligible, needs_verification,
 * redeemed, max_age_days, seats}:
 * eligible only when the account is young enough, has not redeemed any code
 * and passes the redeem function's own check (credit codes: at most 7 days,
 * verified email or Telegram, or 10 distinct answered questions; seats,
 * a-seed-seats: at most 14 days and a verified email or Telegram); a young
 * unverified account reads needs_verification so the card states the
 * condition instead of a form the server would refuse. While seats are off
 * the answer is the credit-code answer, byte for byte.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  const fc = readFreeCreditConfig();
  const seats = seedSeatsReady();
  if (!fc.campaignEnabled && !seats) return NextResponse.json({ enabled: false }, { headers: { "cache-control": "no-store" } });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const sb = getServiceClient();
  const now = new Date();
  if (!seats) {
    const status = await readCampaignStatus(sb, guard.userId, now, fc.campaignAccountMaxAgeDays, fc.welcomeMinQuestions);
    return NextResponse.json({ enabled: true, ...status, max_age_days: fc.campaignAccountMaxAgeDays }, { headers: { "cache-control": "no-store" } });
  }
  const [credit, seat, redeemed, seatEnd] = await Promise.all([
    fc.campaignEnabled ? readCampaignStatus(sb, guard.userId, now, fc.campaignAccountMaxAgeDays, fc.welcomeMinQuestions) : null,
    readSeatStatus(sb, guard.userId, now),
    readRedemption(sb, guard.userId),
    readSeatEnd(sb, guard.userId),
  ]);
  const eligible = !redeemed && ((credit?.eligible ?? false) || seat.eligible);
  return NextResponse.json({
    enabled: true,
    eligible,
    needs_verification: !redeemed && !eligible && ((credit?.needs_verification ?? false) || seat.needs_verification),
    redeemed: redeemed ? { code: redeemed.code, credits: redeemed.credits, ...(seatEnd ? { seat_ends_at: seatEnd } : {}) } : null,
    max_age_days: SEAT_MAX_ACCOUNT_AGE_DAYS,
    // Credit-only codes keep their own, shorter window; the card names both.
    ...(fc.campaignEnabled ? { credit_max_age_days: fc.campaignAccountMaxAgeDays } : {}),
    seats: true,
  }, { headers: { "cache-control": "no-store" } });
});
