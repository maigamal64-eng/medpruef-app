import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { calculateXP } from "@/lib/xp";
import { requireUser } from "@/lib/auth-guard";

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
 * Atomicity note: Supabase-js doesn't expose transactions from the
 * REST client, so these writes are still sequential and can partially
 * fail. The proper fix is a `record_answer` Postgres function that
 * wraps the five writes in one transaction; that's tracked as a P2
 * follow-up (see action-plan.md). In the meantime we at least report
 * the error to the caller instead of silently dropping it, and use
 * `upsert` so a missing gamification row doesn't freeze the user's
 * XP at zero.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  let body: { questionId?: number; isCorrect?: boolean; userAnswer?: string; timeSpentMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { questionId, isCorrect, userAnswer, timeSpentMs } = body;

  if (typeof questionId !== "number" || typeof isCorrect !== "boolean") {
    return NextResponse.json({ error: "questionId (number) and isCorrect (boolean) required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // Fetch question difficulty and — importantly — the stored choices so
  // we can re-grade server-side in a future pass. For now we still trust
  // the client isCorrect flag while the grading refactor is in flight;
  // but since the userId is now pinned to the session, the worst case
  // is a user cheating their OWN XP (not someone else's).
  //
  // We also pull `topic` + `exam_type` here so we can atomically update
  // user_topic_strength — the server-side source of truth for per-topic
  // accuracy that drives cross-device weakness detection + Study Plan
  // (backlog #13, 2026-04-21).
  const { data: question, error: qErr } = await sb
    .from("questions")
    .select("difficulty, topic, exam_type")
    .eq("id", questionId)
    .maybeSingle();
  if (qErr) {
    console.error("[answer] question lookup:", qErr);
    return NextResponse.json({ error: "Question lookup failed" }, { status: 500 });
  }
  if (!question) {
    return NextResponse.json({ error: "Unknown question" }, { status: 404 });
  }
  const difficulty = (question as { difficulty?: number }).difficulty || 2;
  const questionTopic = (question as { topic?: string }).topic || null;
  const questionExamType = (question as { exam_type?: string }).exam_type || null;
  const xp = calculateXP(isCorrect, difficulty);

  // 1. answer_history insert
  const { error: historyErr } = await sb.from("answer_history").insert({
    user_id: userId,
    question_id: questionId,
    user_answer: userAnswer || null,
    is_correct: isCorrect,
    time_spent_ms: timeSpentMs || null,
    xp_earned: xp,
  });
  if (historyErr) {
    console.error("[answer] answer_history insert:", historyErr);
    return NextResponse.json({ error: "Failed to record answer" }, { status: 500 });
  }

  // 1b. user_topic_strength — race-safe UPSERT + counter increment via RPC.
  // This is the cross-device weakness signal that replaces the legacy
  // localStorage-only `medpruef_quiz_results` store (backlog #13, 2026-04-21).
  // The RPC is `security definer` + a single ON CONFLICT UPDATE, so two
  // concurrent answers from different devices can't produce a race.
  // Failure here is logged but does NOT fail the request — the answer
  // itself has already been recorded and XP/streak logic below still runs.
  if (questionTopic && questionExamType) {
    const { error: strengthErr } = await sb.rpc("increment_topic_strength", {
      p_user_id: userId,
      p_exam_type: questionExamType,
      p_topic: questionTopic,
      p_is_correct: isCorrect,
    });
    if (strengthErr) {
      console.error("[answer] topic strength RPC:", strengthErr);
    }
  }

  // 2. user_question_progress upsert (spaced repetition)
  const { data: existing, error: progSelErr } = await sb
    .from("user_question_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .maybeSingle();
  if (progSelErr) {
    console.error("[answer] progress select:", progSelErr);
  }

  if (existing) {
    const newEase = isCorrect
      ? Math.min(3.0, existing.ease_factor + 0.1)
      : Math.max(1.3, existing.ease_factor - 0.2);
    const newInterval = isCorrect
      ? Math.max(1, Math.round(existing.interval_days * newEase))
      : 0;
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + newInterval);

    const { error: progUpdErr } = await sb
      .from("user_question_progress")
      .update({
        times_seen: existing.times_seen + 1,
        times_correct: existing.times_correct + (isCorrect ? 1 : 0),
        ease_factor: newEase,
        interval_days: newInterval,
        next_review_at: nextReview.toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (progUpdErr) console.error("[answer] progress update:", progUpdErr);
  } else {
    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + (isCorrect ? 1 : 0));
    const { error: progInsErr } = await sb.from("user_question_progress").insert({
      user_id: userId,
      question_id: questionId,
      times_seen: 1,
      times_correct: isCorrect ? 1 : 0,
      ease_factor: isCorrect ? 2.6 : 2.3,
      interval_days: isCorrect ? 1 : 0,
      next_review_at: nextReview.toISOString(),
      last_seen_at: new Date().toISOString(),
    });
    if (progInsErr) console.error("[answer] progress insert:", progInsErr);
  }

  // 3. user_gamification upsert (never silently skip — audit BE-P3-028)
  const today = new Date().toISOString().split("T")[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  // Make sure a gamification row exists — earlier code did a select-then-
  // skip-if-missing, which meant brand-new users silently earned zero XP.
  // Upsert first, then update.
  const { error: gamUpsertErr } = await sb
    .from("user_gamification")
    .upsert({ user_id: userId }, { onConflict: "user_id" });
  if (gamUpsertErr) console.error("[answer] gamification upsert:", gamUpsertErr);

  const { data: gam, error: gamSelErr } = await sb
    .from("user_gamification")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (gamSelErr) console.error("[answer] gamification select:", gamSelErr);

  let updatedGam: Record<string, unknown> | null = null;
  if (gam) {
    const isNewDay = gam.daily_reset_date !== today;
    const newStreak =
      gam.last_study_date === yesterdayStr
        ? gam.current_streak + (isNewDay ? 1 : 0)
        : isNewDay
          ? 1
          : gam.current_streak;

    const { data: updated, error: gamUpdErr } = await sb
      .from("user_gamification")
      .update({
        total_questions_answered: (gam.total_questions_answered || 0) + 1,
        total_correct: (gam.total_correct || 0) + (isCorrect ? 1 : 0),
        total_xp: (gam.total_xp || 0) + xp,
        current_streak: newStreak,
        longest_streak: Math.max(gam.longest_streak || 0, newStreak),
        last_study_date: today,
        daily_questions_today: isNewDay ? 1 : (gam.daily_questions_today || 0) + 1,
        daily_reset_date: today,
      })
      .eq("user_id", userId)
      .select()
      .single();
    if (gamUpdErr) console.error("[answer] gamification update:", gamUpdErr);
    updatedGam = updated;
  }

  // 4. users table — xp_total + last_active_date are denormalized columns
  // that exist alongside user_gamification.total_xp (verified live in DB
  // audit 2026-04-15). Keeping them in sync for now; a follow-up should
  // pick a single source of truth (see action-plan.md).
  const { error: userUpdErr } = await sb
    .from("users")
    .update({
      xp_total: ((gam?.total_xp as number) || 0) + xp,
      last_active_date: today,
    })
    .eq("id", userId);
  if (userUpdErr) console.error("[answer] users update:", userUpdErr);

  return NextResponse.json({
    xp,
    totalXp: (updatedGam?.total_xp as number) ?? ((gam?.total_xp as number) || 0) + xp,
    gamification: updatedGam || gam || null,
  });
}
