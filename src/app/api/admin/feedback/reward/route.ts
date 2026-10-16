import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { grantExperienceReward, readExperienceEligibility, TESTIMONIAL_KIND } from "@/lib/mentor/credits/experience";
import { EXAM_REPORT_KIND, grantExamReportReward } from "@/lib/mentor/credits/exam-report";
import { readExamReportGrantsThisMonth } from "@/lib/mentor/credits/rewards";
import { pastSittingByKey, readRewardConfig } from "@/lib/rewards-program";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/feedback/reward {id, confirm?} (feedback.manage + revenue.manage):
 * the thank-you credits for one feedback row: a testimonial (a-free-credit-hooks
 * L5, MENTOR_EXPERIENCE_REWARD_ENABLED) or an exam report (a-rewards-program,
 * REWARDS_EXAM_REPORT_ENABLED). Without confirm: a preview (eligibility facts,
 * consent, already rewarded, the month's breaker). With confirm: the grant,
 * once per key, audited. The admin filters spam only; the decision never
 * depends on what the text says. 404 while the row's reward is off.
 */
export const POST = adminRouteShell(async ({ req, actor }) => {
  const fc = readFreeCreditConfig();
  const rc = readRewardConfig();
  if (!fc.experienceEnabled && !rc.examReportEnabled) return NextResponse.json({ error: "Feedback rewards are off (MENTOR_EXPERIENCE_REWARD_ENABLED, REWARDS_EXAM_REPORT_ENABLED)." }, { status: 404 });
  const perms = await loadAdminPermissionSnapshot(actor.userId);
  if (!canAccessAdminPermission(perms, "feedback.manage") || !canAccessAdminPermission(perms, "revenue.manage")) {
    return NextResponse.json({ error: "Granting a reward needs feedback.manage and revenue.manage." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { id?: unknown; confirm?: unknown } | null;
  const id = typeof body?.id === "number" ? body.id : typeof body?.id === "string" && /^\d{1,18}$/.test(body.id) ? body.id : null;
  if (id === null) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = getServiceClient();
  const now = new Date();

  const fb = await sb.from("user_feedback").select("id, user_id, context").eq("id", id).maybeSingle();
  if (fb.error) throw fb.error;
  const row = fb.data as { user_id: string | null; context: Record<string, unknown> | null } | null;
  const kind = row?.context?.kind;
  const isTestimonial = kind === TESTIMONIAL_KIND && fc.experienceEnabled;
  const isExamReport = kind === EXAM_REPORT_KIND && rc.examReportEnabled;
  if (!row || (!isTestimonial && !isExamReport)) return NextResponse.json({ error: "Not a rewardable feedback row, or its reward is off." }, { status: 404 });

  if (body?.confirm !== true) {
    const consent = ((isTestimonial ? row.context?.testimonial : row.context?.exam_report) ?? {}) as { consent_public?: boolean };
    const sitting = isExamReport ? pastSittingByKey(row.context?.sitting_key, now) : null;
    return NextResponse.json({
      kind,
      credits: isTestimonial ? fc.experienceCredits : rc.examReportCredits,
      expiry_days: isTestimonial ? fc.experienceExpiryDays : rc.examReportExpiryDays,
      consent_public: consent.consent_public === true,
      rewarded: typeof row.context?.reward_granted_at === "string",
      eligibility: row.user_id ? await readExperienceEligibility(sb, row.user_id) : null,
      ...(isExamReport ? {
        sitting: sitting ? { key: sitting.key, label: sitting.label.en } : null,
        month: { granted: await readExamReportGrantsThisMonth(sb, now), cap: rc.examReportMonthlyCap },
      } : {}),
    });
  }

  const r = isTestimonial ? await grantExperienceReward(sb, id, actor.userId, fc, now) : await grantExamReportReward(sb, id, actor.userId, rc, now);
  if (!r.ok) {
    const status = r.reason === "not_found" || r.reason === "not_testimonial" || r.reason === "not_exam_report" ? 404 : r.reason === "grant_failed" ? 503 : 409;
    return NextResponse.json({ error: r.reason }, { status });
  }
  await logAdminAction({ req, actorId: actor.userId, actorEmail: actor.email, action: isTestimonial ? "mentor_experience_reward_granted" : "mentor_exam_report_reward_granted", targetType: "user_feedback", targetId: typeof id === "number" ? id : String(id), payload: { credits: r.credits, lot_id: r.lotId, expires_at: r.expiresAt, ...(isExamReport ? { sitting_key: row.context?.sitting_key } : {}) } });
  return NextResponse.json({ ok: true, credits: r.credits, expires_at: r.expiresAt });
}, { route: "/api/admin/feedback/reward", rateLimit: { limit: 30, windowMs: 60_000 } });
