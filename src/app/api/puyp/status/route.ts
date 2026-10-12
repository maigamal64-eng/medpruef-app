import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { isPuypEligibleTier } from "@/lib/nowpayments";
import {
  computeQbankCompletion,
  meetsPuypCompletionGate,
  PUYP_MAX_EXTENSIONS,
  type PuypExamType,
} from "@/lib/puyp";

export const dynamic = "force-dynamic";

/**
 * GET /api/puyp/status — snapshot of the user's Pass-Until-You-Pass
 * eligibility for the exam-result UI.
 *
 * Returns everything the /dashboard/exam-result page needs to render
 * without a second round-trip:
 *   { eligible, reason?, reason_code?,
 *     subscription?: { tier, expires_at, puyp_extensions_used },
 *     exam_type, exam_date,
 *     qbank_completion_pct, qbank_answered, qbank_total,
 *     meets_completion_gate }
 *
 * Eligibility rules (Lock #1 April 23 2026):
 *   - Must have an active subscription (status='active').
 *   - Tier must be PUYP-eligible (isPuypEligibleTier).
 *   - puyp_extensions_used must be < 2.
 *
 * "eligible=false" still returns the bank stats so the UI can show
 * them in the non-eligible branch as context. reason_code is one of
 * no_subscription | tier_not_eligible | cap_reached (a24, UX-EXM-46: the page
 * never shows an upsell for a load failure and every learner can record a
 * fail; only eligible learners go through the proof claim).
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  try {
    const sb = getServiceClient();

    const { data: user, error: userErr } = await sb
      .from("users")
      .select("active_exam, exam_date")
      .eq("id", userId)
      .maybeSingle();

    if (userErr || !user) {
      captureServerError(userErr, {
        route: "/api/puyp/status",
        userId,
        step: "user_lookup",
      });
      return NextResponse.json(
        { error: "User lookup failed" },
        { status: 500 }
      );
    }

    const examType =
      ((user.active_exam as string | null) || "kenntnispruefung") as PuypExamType;

    // Qbank completion snapshot — returned regardless of eligibility.
    const completion = await computeQbankCompletion(userId, examType);

    // Find the user's most-recent active subscription (if any).
    const { data: activeSub, error: subErr } = await sb
      .from("subscriptions")
      .select("tier, expires_at, puyp_extensions_used, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // A failed read must not look like "no plan": an eligible learner would
    // then see the no-guarantee branch. Fail the request; the page shows a
    // load error with "Erneut laden" (UX-EXM-46).
    if (subErr) {
      captureServerError(subErr, { route: "/api/puyp/status", userId, step: "subscription_lookup" });
      return NextResponse.json({ error: "Subscription lookup failed" }, { status: 500 });
    }

    // Eligibility decision. `reason_code` is what the page localises (a24,
    // UX-EXM-46); `reason` stays an English diagnostic for logs and agents.
    let eligible = false;
    let reason: string | undefined;
    let reasonCode: "no_subscription" | "tier_not_eligible" | "cap_reached" | undefined;

    if (!activeSub) {
      reasonCode = "no_subscription";
      reason =
        "No active subscription. Pass-Until-You-Pass requires an active Exam Cohort plan.";
    } else if (!isPuypEligibleTier(activeSub.tier as string | null)) {
      reasonCode = "tier_not_eligible";
      reason =
        "Your current plan is not eligible for Pass-Until-You-Pass. The guarantee applies to the Exam Cohort only.";
    } else if (
      (Number(activeSub.puyp_extensions_used) || 0) >= PUYP_MAX_EXTENSIONS
    ) {
      reasonCode = "cap_reached";
      reason = `You've already used the maximum ${PUYP_MAX_EXTENSIONS} Pass-Until-You-Pass extensions on this subscription.`;
    } else {
      eligible = true;
    }

    return NextResponse.json({
      eligible,
      reason,
      reason_code: reasonCode,
      subscription: activeSub
        ? {
            tier: activeSub.tier,
            expires_at: activeSub.expires_at,
            puyp_extensions_used:
              Number(activeSub.puyp_extensions_used) || 0,
          }
        : undefined,
      exam_type: examType,
      exam_date: user.exam_date,
      qbank_completion_pct: completion.pct,
      qbank_answered: completion.answered,
      qbank_total: completion.total,
      meets_completion_gate: meetsPuypCompletionGate(completion),
    });
  } catch (err) {
    captureServerError(err, { route: "/api/puyp/status", userId });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
