import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { readCampaignStatus } from "@/lib/mentor/credits/campaign";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/mentor/campaign/status: may this account still redeem a code?
 * {enabled:false} while MENTOR_CAMPAIGN_CODES_ENABLED is off (no read).
 * Otherwise {enabled, eligible, needs_verification, redeemed, max_age_days}:
 * eligible only when the account is at most 7 days old, has not redeemed any
 * code and passes the redeem function's own check (verified email or Telegram,
 * or 10 distinct answered questions); a young unverified account reads
 * needs_verification so the card states the condition instead of a form the
 * server would refuse.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  const fc = readFreeCreditConfig();
  if (!fc.campaignEnabled) return NextResponse.json({ enabled: false }, { headers: { "cache-control": "no-store" } });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const status = await readCampaignStatus(getServiceClient(), guard.userId, new Date(), fc.campaignAccountMaxAgeDays, fc.welcomeMinQuestions);
  return NextResponse.json({
    enabled: true,
    ...status,
    max_age_days: fc.campaignAccountMaxAgeDays,
  }, { headers: { "cache-control": "no-store" } });
});
