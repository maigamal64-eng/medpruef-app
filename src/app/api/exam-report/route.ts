import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { readExperienceEligibility } from "@/lib/mentor/credits/experience";
import { EXAM_REPORT_KIND } from "@/lib/mentor/credits/exam-report";
import { rewardKey } from "@/lib/mentor/credits/rewards";
import { examReportPromptSittings, readRewardConfig } from "@/lib/rewards-program";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "cache-control": "no-store" };

/**
 * GET /api/exam-report: the Settings "how was your exam" card state
 * (a-rewards-program). {enabled:false} while REWARDS_EXAM_REPORT_ENABLED is
 * off or no official sitting is open for reports today (no read). Otherwise
 * {enabled, eligible, credits, expiry_days, sittings:[{key, label, sent,
 * rewarded}]} for the signed-in learner; the card shows only when eligible
 * (L5 bar). Sittings: last day passed at most 30 days ago, never on an
 * official sitting day or a blackout day.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  const rc = readRewardConfig();
  const now = new Date();
  const open = rc.examReportEnabled ? examReportPromptSittings(now) : [];
  if (open.length === 0) return NextResponse.json({ enabled: false }, { headers: noStore });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;
  const sb = getServiceClient();
  const keys = open.map((s) => rewardKey({ kind: "exam_report", userId, sittingKey: s.key }).sourceId);
  const [sent, lots, eligibility] = await Promise.all([
    sb.from("user_feedback").select("context").eq("user_id", userId).eq("context->>kind", EXAM_REPORT_KIND).in("context->>sitting_key", open.map((s) => s.key)).limit(20),
    sb.from("ai_credit_lot").select("source_id").eq("user_id", userId).eq("source", "admin_gift").in("source_id", keys),
    readExperienceEligibility(sb, userId),
  ]);
  if (sent.error) throw sent.error;
  if (lots.error) throw lots.error;
  const sentKeys = new Set(((sent.data ?? []) as Array<{ context: Record<string, unknown> | null }>).map((r) => r.context?.sitting_key));
  const rewardedIds = new Set(((lots.data ?? []) as Array<{ source_id: string }>).map((r) => r.source_id));
  return NextResponse.json({
    enabled: true,
    eligible: eligibility.meetsBar,
    credits: rc.examReportCredits,
    expiry_days: rc.examReportExpiryDays,
    sittings: open.map((s, i) => ({ key: s.key, label: s.label, sent: sentKeys.has(s.key), rewarded: rewardedIds.has(keys[i]) })),
  }, { headers: noStore });
});
