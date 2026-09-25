import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { qualifyReferralOnActivity } from "@/lib/referral-exam-reward";

export const dynamic = "force-dynamic";

/**
 * POST /api/answer
 *
 * Record an answer, update spaced-rep progress, award XP, bump streak.
 *
 * Auth: `requireUser` — the userId comes from the `x-user-id` header
 * (verified against the users table), NOT from the body. Any body-
 * supplied `userId` is ignored. This closes BE-P0-003 / SEC-P0 from
 * the 2026-04-15 audit (client-trust on a hot mutating path).
 *
 * Error handling: every write is now checked. Previously errors were
 * silently swallowed, which caused the "daily goal stuck at 0" /
 * "XP didn't save" class of bugs. See BE-P0-005 in 03-backend-api.md.
 *
 * The answer history, spaced repetition, gamification, user totals, and
 * topic-strength counters are written by one Postgres transaction. The
 * client request ID makes a retry safe if the response was lost.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  // Tier-aware branches. Free users still record answers + XP on
  // free-slice questions (so signup still feels rewarding), but they
  // DON'T get spaced-repetition scheduling — that's Pro. This matches
  // the Lock 2026-04-23 gating decision: bookmarks, notes, mock exam,
  // SR, and wrong-only practice are Pro-only. The questions route
  // already gates fetches; /api/answer only has to skip the SR write.
  //
  // 2026-04-24: switched from `isFreeTier(tier)` to `isFreeAccess(guard)`
  // so admins (role='admin', tier='free' possible) retain full SR
  // scheduling. Fixes the case where /admin/ operators testing the
  // product lost their spaced-rep history because the system treated
  // them as free.
  const isFreeUser = isFreeAccess(guard);

  let body: { questionId?: number; isCorrect?: boolean; userAnswer?: string; timeSpentMs?: number; requestId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { questionId, isCorrect, userAnswer, timeSpentMs, requestId } = body;
  if (requestId !== undefined && (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))) {
    return NextResponse.json({ error: "Invalid requestId" }, { status: 400 });
  }

  if (typeof questionId !== "number" || typeof isCorrect !== "boolean") {
    return NextResponse.json({ error: "questionId (number) and isCorrect (boolean) required" }, { status: 400 });
  }

  // Top-level try/catch wraps the atomic write and ancillary effects. Any unexpected
  // throw (DB connectivity blip, RPC timeout, etc.) captures to Sentry
  // with userId + questionId attached, then returns a sanitized 500 so
  // we don't leak stack traces to the client. Per-write errors below
  // are still logged individually for finer-grained debugging.
  try {
  const sb = getServiceClient();

  // Validate the question before recording it. The RPC repeats the active
  // check in the same transaction to close the deactivation race.
  const { data: question, error: qErr } = await sb
    .from("questions")
    .select("difficulty, topic, exam_type")
    .eq("id", questionId)
    .eq("is_active", true)
    .maybeSingle();
  if (qErr) {
    console.error("[answer] question lookup:", qErr);
    return NextResponse.json({ error: "Question lookup failed" }, { status: 500 });
  }
  if (!question) {
    return NextResponse.json({ error: "Unknown question" }, { status: 404 });
  }
  const { data: recorded, error: recordErr } = await sb.rpc("record_quiz_answer", {
    p_user_id: userId,
    p_question_id: questionId,
    p_is_correct: isCorrect,
    p_user_answer: userAnswer || null,
    p_time_spent_ms: timeSpentMs || null,
    p_is_free: isFreeUser,
    p_request_id: requestId || null,
  });
  if (recordErr) {
    console.error("[answer] atomic answer RPC:", recordErr);
    if (recordErr.message?.includes("QUESTION_UNAVAILABLE")) {
      return NextResponse.json({ error: "Question is no longer available" }, { status: 409 });
    }
    if (recordErr.message?.includes("IDEMPOTENCY_KEY_CONFLICT")) {
      return NextResponse.json({ error: "Request already used for another answer" }, { status: 409 });
    }
    throw new Error("Answer could not be saved");
  }
  const result = recorded as { saved?: boolean; duplicate?: boolean; xp?: number; totalXp?: number; gamification?: Record<string, unknown> | null };
  if (!result?.saved) throw new Error("Answer save was not confirmed");
  const xp = result.xp ?? 0;
  const updatedGam = result.gamification ?? null;

  // These are ancillary signals. Their helpers are best-effort and never
  // affect the saved answer or its counters.
  if (!result.duplicate) {
    try { await qualifyReferralOnActivity(sb, userId); }
    catch (referralErr) { console.error("[answer] referral exam-reward qualification:", referralErr); }
    try {
      await sb.rpc("increment_user_announcements_qs", { p_user_id: userId });
    } catch (announceErr) {
      console.error("[answer] user_announcements bump:", announceErr);
    }
  }

  return NextResponse.json({
    saved: true,
    duplicate: Boolean(result.duplicate),
    xp,
    totalXp: result.totalXp ?? null,
    gamification: updatedGam,
  });

  } catch (err) {
    captureServerError(err, {
      route: "/api/answer",
      userId,
      questionId,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
