import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { generateStudyPlan, unseenTotal, type TopicProgress } from "@/lib/studyPlan";
import { buildRollingStudyPlan } from "@/lib/study-p0";
import { EXAM_SOURCE_IDS, DEFAULT_EXAM_SOURCE } from "@/lib/topics";
import { getTopicCountsCached } from "@/lib/free-tier";
import { simulationPresetFor, studyPlanTarget } from "@/lib/study-plan-target";
import { answersToday, viennaDay } from "@/lib/home-study-core";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dbUnavailableResponse, withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
 * a25 (LX-01-R, pick-plan-target A): without an exam date the plan targets
 * the next official sitting of the active bank, labelled provisional, and
 * users.exam_date is never written here. With a past date (LX-03-R) the plan
 * also targets the next sitting and the response carries `expired` plus up to
 * three `nextSittings` for a one-tap switch. The open-ended rolling plan
 * stays available for learners who chose "no date yet" (UX-STU-16).
 *
 * Query: `focus=weak` limits the plan to weak topics (LX-02 "Auf schwache
 * Themen eingrenzen"); ignored when there are none.
 *
 * Auth: requireUser — userId comes from the session header, not the body.
 */
async function handleGET(req: NextRequest) {
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


    const dailyGoal =
      typeof userRow.daily_goal === "number" && userRow.daily_goal > 0
        ? userRow.daily_goal
        : 20;

    const activeExam =
      typeof userRow.active_exam === "string" &&
      (EXAM_SOURCE_IDS as string[]).includes(userRow.active_exam)
        ? userRow.active_exam
        : DEFAULT_EXAM_SOURCE;

    // 2) Per-topic totals: the shared 1 h per-instance get_topic_counts cache
    // (a-stability). An error only when the read fails and nothing is cached.
    const { data: topicCounts, error: topicErr } = await getTopicCountsCached(sb, activeExam);

    // a-db-timeouts (ERR-05): the plan is built from the bank totals, so a
    // failed or empty read is a typed error, never a 200 with a partial plan.
    if (topicErr) {
      console.error("[study-plan GET] topic counts error:", topicErr);
      if (isDbUnavailable(topicErr)) return dbUnavailableResponse();
      return NextResponse.json(
        { error: "Failed to load topic counts", code: "TOPIC_COUNTS_FAILED" },
        { status: 500 }
      );
    }
    if (!topicCounts || topicCounts.length === 0) {
      console.error("[study-plan GET] topic counts empty for", activeExam);
      return NextResponse.json(
        { error: "Failed to load topic counts", code: "TOPIC_COUNTS_EMPTY" },
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
      return NextResponse.json({ error: "Failed to load progress" }, { status: 500 });
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

    const examDate = typeof userRow.exam_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(userRow.exam_date)
      ? userRow.exam_date.slice(0, 10)
      : null;
    // One calendar for the whole response: the learner's Vienna day. The pure
    // modules count UTC days, so they get noon UTC of that Vienna day.
    const now = new Date();
    const todayISO = viennaDay(now);
    const planNow = new Date(`${todayISO}T12:00:00Z`);
    const target = studyPlanTarget(activeExam, examDate, planNow);

    // Answers today (Vienna day) from the server counters, so the plan never
    // shows yesterday's total after midnight or on another device (UX-STU-19).
    const { data: gam } = await sb
      .from("user_gamification")
      .select("daily_questions_today, daily_reset_date")
      .eq("user_id", userId)
      .maybeSingle();
    const answeredToday = gam ? answersToday(gam.daily_questions_today, gam.daily_reset_date, todayISO) : null;

    const weakOnlyAsked = req.nextUrl.searchParams.get("focus") === "weak";
    const weakTopics = availableTopics.filter(t => t.answered > 0 && t.accuracy < 60);
    const focusWeak = weakOnlyAsked && weakTopics.length > 0;
    const planTopics = focusWeak ? weakTopics : availableTopics;

    const plan = generateStudyPlan({
      examDate: new Date(`${target.targetDate}T00:00:00Z`),
      dailyQuestionGoal: dailyGoal,
      availableTopics: planTopics,
      now: planNow,
      simulationPresetId: simulationPresetFor(activeExam),
      lightDays: true,
    });

    let rollingPlan: ReturnType<typeof buildRollingStudyPlan> | undefined;
    if (!examDate) {
      const { count: dueReviews, error: dueErr } = await sb
        .from("user_question_progress")
        .select("question_id, questions!inner(exam_type, is_active)", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("questions.exam_type", activeExam)
        .eq("questions.is_active", true)
        .lte("next_review_at", now.toISOString());
      if (dueErr) return NextResponse.json({ error: "Failed to load due reviews" }, { status: 500 });
      rollingPlan = buildRollingStudyPlan(availableTopics, dueReviews ?? 0);
    }

    return NextResponse.json({
      plan,
      hasExamDate: !!examDate,
      examDate,
      targetDate: target.targetDate,
      provisional: target.provisional,
      targetSource: target.source,
      expired: target.expired,
      nextSittings: target.nextSittings,
      dailyGoal,
      activeExam,
      todayISO,
      // Totals of the planned pool, so "reach X of Y" never mixes a weak-only plan with the whole bank.
      unseenTotal: unseenTotal(planTopics),
      bankTotal: planTopics.reduce((sum, t) => sum + t.total, 0),
      answeredToday,
      focus: focusWeak ? "weak" : "all",
      weakAvailable: weakTopics.length > 0,
      ...(rollingPlan ? { rollingPlan } : {}),
    });
  } catch (err) {
    console.error("[study-plan GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withDbUnavailable(handleGET);
