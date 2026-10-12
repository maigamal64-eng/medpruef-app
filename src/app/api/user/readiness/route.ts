import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { generateStudyPlan, type TopicProgress } from "@/lib/studyPlan";
import { computeReadiness, consistencyFromActivity, type Trend } from "@/lib/readiness";
import { EXAM_SOURCE_IDS, DEFAULT_EXAM_SOURCE } from "@/lib/topics";
import { getTopicCountsCached } from "@/lib/free-tier";
import { buildFieldReadiness } from "@/lib/field-readiness";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/user/readiness  (Phase A.2)
 *
 * Honest, banded readiness signal for the authenticated user, scoped to
 * their active exam. Computes the band SERVER-SIDE and returns ONLY the
 * band + descriptive factor sub-scores + the trend. The raw composite
 * score never leaves the server (a visible number reads as a pass
 * prediction, which is the liability we are avoiding).
 *
 * Returns: { band, factors:{coverage,accuracy,consistency,pace}, trend,
 *            lowestFactor, hasExamDate, activeExam, fields }
 *
 * a25 (CNT-42): `fields` is the per-field status against the 60 percent mark
 * from the same topic-strength counters (minimum sample stated). It is
 * additive and does not feed the band; the composite formula is unchanged
 * (UX-STU-32 waits for [name]'s readiness parameters).
 *
 * Auth: requireUser — userId comes from the session header, not the body.
 */

const COVERAGE_MIN_ANSWERED = 10; // a topic "counts" as covered at >=10 answered

async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sb = getServiceClient();

    const { data: userRow } = await sb
      .from("users")
      .select("exam_date, daily_goal, active_exam")
      .eq("id", userId)
      .maybeSingle();

    const activeExam =
      typeof userRow?.active_exam === "string" &&
      (EXAM_SOURCE_IDS as string[]).includes(userRow.active_exam)
        ? userRow.active_exam
        : DEFAULT_EXAM_SOURCE;
    const dailyGoal =
      typeof userRow?.daily_goal === "number" && userRow.daily_goal > 0 ? userRow.daily_goal : 20;
    const examDate = userRow?.exam_date || null;

    // Per-topic totals + the user's per-topic answered/correct (same
    // sources the study-plan route uses).
    // Bank-wide counts: the shared 1 h per-instance cache (a-stability), the
    // same one topic-progress and the topic list use, so a Home load no
    // longer runs get_topic_counts once per route.
    const { data: topicCounts } = await getTopicCountsCached(sb, activeExam);
    const { data: strengthRows } = await sb
      .from("user_topic_strength")
      .select("topic, answered, correct")
      .eq("user_id", userId)
      .eq("exam_type", activeExam);

    const strengthAgg: Record<string, { answered: number; correct: number }> = {};
    for (const row of strengthRows || []) {
      strengthAgg[row.topic as string] = {
        answered: Number(row.answered) || 0,
        correct: Number(row.correct) || 0,
      };
    }

    // Recent answer_history for this exam: created_at + is_correct, newest
    // first, capped. Drives recent accuracy, the trend, and active days.
    const { data: recentAnswers } = await sb
      .from("answer_history")
      .select("is_correct, created_at, questions!inner(exam_type)")
      .eq("user_id", userId)
      .eq("questions.exam_type" as string, activeExam)
      .order("created_at", { ascending: false })
      .limit(600);

    const answers = (recentAnswers || []) as Array<{ is_correct: boolean; created_at: string }>;

    // Coverage + overall accuracy from topic strength (cross-device).
    const availableTopics: TopicProgress[] = ((topicCounts || []) as { topic: string; count: number }[]).map(
      (tc) => {
        const s = strengthAgg[tc.topic];
        const answered = s ? s.answered : 0;
        const correct = s ? s.correct : 0;
        const total = Number(tc.count) || 0;
        return { topic: tc.topic, total, answered, correct, accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0 };
      },
    );

    const totalWeight = availableTopics.reduce((s, t) => s + t.total, 0);
    const coveredWeight = availableTopics.reduce(
      (s, t) => s + (t.answered >= COVERAGE_MIN_ANSWERED ? t.total : 0),
      0,
    );
    const coverageFraction = totalWeight > 0 ? coveredWeight / totalWeight : 0;

    const totalAnswered = availableTopics.reduce((s, t) => s + t.answered, 0);
    const totalCorrect = availableTopics.reduce((s, t) => s + t.correct, 0);

    // Recent accuracy: last 100 answers if we have them, else the lifetime
    // topic-strength accuracy.
    const recent100 = answers.slice(0, 100);
    const recentAccuracyPct =
      recent100.length >= 20
        ? Math.round((recent100.filter((a) => a.is_correct).length / recent100.length) * 100)
        : totalAnswered > 0
          ? Math.round((totalCorrect / totalAnswered) * 100)
          : 0;

    // Trend: last 50 vs the prior 50 (needs enough data to be meaningful).
    let trend: Trend = "flat";
    if (answers.length >= 60) {
      const last = answers.slice(0, 50);
      const prev = answers.slice(50, 100);
      const accOf = (arr: typeof answers) =>
        arr.length ? arr.filter((a) => a.is_correct).length / arr.length : 0;
      const d = accOf(last) - accOf(prev);
      trend = d > 0.05 ? "up" : d < -0.05 ? "down" : "flat";
    }

    // Active days + recency from the fetched window (accurate at the low
    // end, which is all the "just started" gate needs).
    const dayset = new Set<string>();
    for (const a of answers) if (a.created_at) dayset.add(a.created_at.slice(0, 10));
    const activeDaysTotal = dayset.size;
    let daysSinceLastStudy = 999;
    if (answers[0]?.created_at) {
      const last = new Date(answers[0].created_at);
      const now = new Date();
      daysSinceLastStudy = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
    }
    const activeInLast7Days = daysSinceLastStudy <= 7;

    // Consistency from gamification.
    const { data: gam } = await sb
      .from("user_gamification")
      .select("current_streak, daily_questions_today")
      .eq("user_id", userId)
      .maybeSingle();
    const consistencyScore = consistencyFromActivity({
      currentStreak: Number(gam?.current_streak) || 0,
      daysSinceLastStudy,
      hitGoalToday: (Number(gam?.daily_questions_today) || 0) >= dailyGoal,
    });

    // Pace vs plan (only with an exam date).
    let paceRatio: number | null = null;
    if (examDate) {
      try {
        const plan = generateStudyPlan({
          examDate: new Date(examDate),
          dailyQuestionGoal: dailyGoal,
          availableTopics,
        });
        const todayISO = new Date().toISOString().slice(0, 10);
        const expectedByToday = plan.dailySchedule
          .filter((d) => d.day <= todayISO)
          .reduce((s, d) => s + d.totalQuestions, 0);
        paceRatio = expectedByToday > 0 ? Math.min(1, totalAnswered / expectedByToday) : 1;
      } catch {
        paceRatio = null;
      }
    }

    const result = computeReadiness({
      coverageFraction,
      recentAccuracyPct,
      consistencyScore,
      paceRatio,
      activeDaysTotal,
      activeInLast7Days,
      trend,
    });

    const fields = buildFieldReadiness(
      activeExam,
      availableTopics.map((t) => ({ topic: t.topic, answered: t.answered, correct: t.correct })),
      availableTopics.map((t) => t.topic),
    );

    return NextResponse.json({
      ...result,
      hasExamDate: !!examDate,
      activeExam,
      fields,
    });
  } catch (err) {
    console.error("[readiness GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withDbUnavailable(handleGET);
