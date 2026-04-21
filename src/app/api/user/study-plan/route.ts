import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { generateStudyPlan, type TopicProgress } from "@/lib/studyPlan";
import { EXAM_SOURCE_IDS, DEFAULT_EXAM_SOURCE } from "@/lib/topics";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/study-plan
 *
 * Returns a generated study plan (Lernplan) for the authenticated user
 * based on:
 *   - users.exam_date      — target exam date
 *   - users.daily_goal     — daily question target
 *   - users.active_exam    — which exam's topic pool to build against
 *   - answer_history       — per-topic answered/correct counts
 *   - questions (per topic) — total questions available per topic
 *
 * When the user hasn't set an exam date, we return
 *   { plan: null, hasExamDate: false }
 * so the UI can render an onboarding CTA instead of an empty calendar.
 *
 * Auth: requireUser — userId comes from the session header, not the body.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sb = getServiceClient();

    // 1) Load the user row to pick up exam_date, daily_goal, active_exam
    const { data: userRow, error: userErr } = await sb
      .from("users")
      .select("exam_date, daily_goal, active_exam")
      .eq("id", userId)
      .maybeSingle();

    if (userErr) {
      console.error("[study-plan GET] user lookup error:", userErr);
      return NextResponse.json(
        { error: "Failed to load user" },
        { status: 500 }
      );
    }

    if (!userRow) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!userRow.exam_date) {
      return NextResponse.json({ plan: null, hasExamDate: false });
    }

    const dailyGoal =
      typeof userRow.daily_goal === "number" && userRow.daily_goal > 0
        ? userRow.daily_goal
        : 20;

    const activeExam =
      typeof userRow.active_exam === "string" &&
      (EXAM_SOURCE_IDS as string[]).includes(userRow.active_exam)
        ? userRow.active_exam
        : DEFAULT_EXAM_SOURCE;

    // 2) Per-topic totals from the RPC we already use on /api/user/topic-progress
    const { data: topicCounts, error: topicErr } = await sb.rpc("get_topic_counts", {
      p_exam_type: activeExam,
    });

    if (topicErr) {
      console.error("[study-plan GET] topic counts error:", topicErr);
      return NextResponse.json(
        { error: "Failed to load topic counts" },
        { status: 500 }
      );
    }

    // 3) Per-topic answered/correct for this user, scoped to the active exam.
    //
    // Preferred source: `user_topic_strength` — the server-side counters
    // populated by /api/answer via the `increment_topic_strength` RPC
    // (backlog #13, 2026-04-21). This is cross-device and a single-row
    // lookup per topic, so it's cheaper than scanning answer_history.
    //
    // Fallback: `answer_history` — used when the strength row is missing
    // (e.g. pre-backfill, or a topic the user hasn't touched on any
    // device yet). The fallback is also used as a secondary check so a
    // topic that's in answer_history but not yet in user_topic_strength
    // still influences the plan.
    const { data: strengthRows, error: strengthErr } = await sb
      .from("user_topic_strength")
      .select("topic, answered, correct")
      .eq("user_id", userId)
      .eq("exam_type", activeExam);

    if (strengthErr) {
      console.error("[study-plan GET] topic strength error:", strengthErr);
      // Fall through to the answer_history-only path below.
    }

    const strengthAgg: Record<string, { answered: number; correct: number }> = {};
    for (const row of strengthRows || []) {
      const topic = row.topic as string;
      strengthAgg[topic] = {
        answered: Number(row.answered) || 0,
        correct: Number(row.correct) || 0,
      };
    }

    // Pull answer_history as a fallback — only used for topics the new
    // table hasn't caught up on. Cheap because we filter by user + exam.
    const { data: answerStats, error: answerErr } = await sb
      .from("answer_history")
      .select("question_id, is_correct, questions!inner(topic, exam_type)")
      .eq("user_id", userId)
      .eq("questions.exam_type" as string, activeExam)
      .limit(50000);

    if (answerErr) {
      console.error("[study-plan GET] answer history error:", answerErr);
      // Degrade gracefully — still produce a plan with zero progress.
    }

    // Aggregate per-topic answered/correct using distinct question_ids
    // so repeated answers on the same question don't inflate counts
    // (matches the behavior of /api/user/topic-progress).
    const historyAgg: Record<
      string,
      { answered: Set<number>; correct: Set<number> }
    > = {};
    for (const row of answerStats || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topic = (row as any).questions?.topic as string | undefined;
      if (!topic) continue;
      if (!historyAgg[topic]) historyAgg[topic] = { answered: new Set(), correct: new Set() };
      historyAgg[topic].answered.add(row.question_id);
      if (row.is_correct) historyAgg[topic].correct.add(row.question_id);
    }

    const availableTopics: TopicProgress[] = (
      (topicCounts || []) as { topic: string; count: number }[]
    ).map(tc => {
      // Prefer the server-side counters (cross-device, cumulative).
      const s = strengthAgg[tc.topic];
      const h = historyAgg[tc.topic];
      const answered = s
        ? s.answered
        : h
          ? h.answered.size
          : 0;
      const correct = s
        ? s.correct
        : h
          ? h.correct.size
          : 0;
      const total = Number(tc.count) || 0;
      return {
        topic: tc.topic,
        total,
        answered,
        correct,
        accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      };
    });

    const plan = generateStudyPlan({
      examDate: new Date(userRow.exam_date),
      dailyQuestionGoal: dailyGoal,
      availableTopics,
    });

    return NextResponse.json({
      plan,
      hasExamDate: true,
      examDate: userRow.exam_date,
      dailyGoal,
      activeExam,
    });
  } catch (err) {
    console.error("[study-plan GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
