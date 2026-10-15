import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { readFreeCreditConfig, experienceRewardSourceId } from "@/lib/mentor/credits/free-credits";
import { TESTIMONIAL_KIND, readExperienceEligibility } from "@/lib/mentor/credits/experience";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/testimonial: the Settings "share your experience" card state.
 * {enabled:false} while MENTOR_EXPERIENCE_REWARD_ENABLED is off (no read).
 * Otherwise {enabled, eligible, credits, submitted, rewarded} for the signed-in
 * learner; the card shows only when eligible (L5 bar) or already sent.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  const fc = readFreeCreditConfig();
  if (!fc.experienceEnabled) return NextResponse.json({ enabled: false }, { headers: { "cache-control": "no-store" } });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const sb = getServiceClient();
  const [sent, lot, eligibility] = await Promise.all([
    sb.from("user_feedback").select("id").eq("user_id", guard.userId).eq("context->>kind", TESTIMONIAL_KIND).limit(1),
    sb.from("ai_credit_lot").select("id").eq("source", "experience_reward").eq("source_id", experienceRewardSourceId(guard.userId)).limit(1),
    readExperienceEligibility(sb, guard.userId),
  ]);
  if (sent.error) throw sent.error;
  if (lot.error) throw lot.error;
  return NextResponse.json({
    enabled: true,
    eligible: eligibility.meetsBar,
    credits: fc.experienceCredits,
    expiry_days: fc.experienceExpiryDays,
    submitted: (sent.data ?? []).length > 0,
    rewarded: (lot.data ?? []).length > 0,
  }, { headers: { "cache-control": "no-store" } });
});
