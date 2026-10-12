import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { grantExamRewardToReferrer } from "@/lib/referral-exam-reward";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/referrals/grant-exam-reward
 * Body: { referrer_user_id: string }
 *
 * The ONLY place in the codebase that executes a Level-2 referral
 * exam-reward grant (src/lib/referral-exam-reward.ts). Modeled on
 * src/app/api/admin/referrals/mark-paid/route.ts. A human clicks this
 * from the "Pending exam-reward grants" list on /admin/referrals after
 * reviewing the farm signals (signup method, timestamps, email domain,
 * distinct-question count, distinct-day span) surfaced there.
 *
 * No-ops safely (200 + granted:false) if REFERRAL_EXAM_REWARD_ENABLED
 * is off, the referrer has no active_exam, or the grant would regress
 * an existing later expiry — see grantExamRewardToReferrer's reason
 * codes.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { referrer_user_id?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.referrer_user_id) {
      return NextResponse.json(
        { error: "referrer_user_id required" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();
    const result = await grantExamRewardToReferrer(sb, body.referrer_user_id);

    if (!result.granted) {
      return NextResponse.json(
        { ok: true, granted: false, reason: result.reason },
        { status: 200 }
      );
    }

    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "grant_referral_exam_reward",
      targetType: "user",
      targetId: body.referrer_user_id,
      payload: {
        new_expiry: result.newExpiry,
      },
    });

    return NextResponse.json({
      ok: true,
      granted: true,
      new_expiry: result.newExpiry,
    });
  },
  {
    route: "/api/admin/referrals/grant-exam-reward",
    rateLimit: { limit: 30, windowMs: 60_000 },
  }
);
