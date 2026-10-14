/**
 * Server loader for the Home study snapshot (UX-HOME-09, LX-10, UX-HOME-12,
 * UX-HOME-20). Called by GET /api/auth/me?include=study for the signed-in
 * learner only; every read is filtered by the guard's user id. Decisions live
 * in home-study-core.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  activeDaysLast7, answersToday, daysBetween, effectiveStreak, hitRatePct, shiftDay, studyPhase, viennaDay,
  type StudySnapshot,
} from "@/lib/home-study-core";
import { EXAM_SOURCE_IDS } from "@/lib/topics";

const WEEK_ROW_CAP = 2000;

/** The users columns the snapshot needs; the guard's own lookup already holds them (a-fo-10). */
export interface StudyProfileFields {
  activeExam: string | null;
  examDate: string | null;
  dailyGoal: number | null;
}

export async function loadStudySnapshot(
  sb: SupabaseClient,
  userId: string,
  now: Date = new Date(),
  known?: StudyProfileFields,
): Promise<StudySnapshot> {
  const today = viennaDay(now);
  const since = new Date(Date.parse(`${shiftDay(today, -7)}T00:00:00Z`)).toISOString();

  const [userRes, gamRes, weekRes] = await Promise.all([
    known
      ? Promise.resolve({ data: { active_exam: known.activeExam, exam_date: known.examDate, daily_goal: known.dailyGoal }, error: null })
      : sb.from("users").select("active_exam, exam_date, daily_goal").eq("id", userId).maybeSingle(),
    sb.from("user_gamification")
      .select("current_streak, last_study_date, daily_questions_today, daily_reset_date, total_questions_answered")
      .eq("user_id", userId).maybeSingle(),
    sb.from("answer_history").select("created_at").eq("user_id", userId)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(WEEK_ROW_CAP),
  ]);
  if (userRes.error || gamRes.error || weekRes.error) throw new Error("study snapshot read failed");

  const activeExam = typeof userRes.data?.active_exam === "string" && (EXAM_SOURCE_IDS as readonly string[]).includes(userRes.data.active_exam)
    ? userRes.data.active_exam : null;

  let hitRate: number | null = null;
  if (activeExam) {
    const { data: strength, error } = await sb.from("user_topic_strength").select("answered, correct")
      .eq("user_id", userId).eq("exam_type", activeExam);
    if (error) throw new Error("study snapshot strength read failed");
    let answered = 0, correct = 0;
    for (const row of strength ?? []) { answered += Number(row.answered) || 0; correct += Number(row.correct) || 0; }
    hitRate = hitRatePct(correct, answered);
  }

  const gam = gamRes.data;
  const lastStudyDate = typeof gam?.last_study_date === "string" ? gam.last_study_date.slice(0, 10) : null;
  const totalAnswered = Math.max(0, Number(gam?.total_questions_answered) || 0);
  const goal = Number(userRes.data?.daily_goal);
  return {
    day: today,
    streak: effectiveStreak(gam?.current_streak, lastStudyDate, today),
    answersToday: answersToday(gam?.daily_questions_today, gam?.daily_reset_date, today),
    dailyGoal: Number.isFinite(goal) && goal > 0 ? goal : 20,
    activeDays7: activeDaysLast7((weekRes.data ?? []).map((r) => r.created_at as string), now),
    totalAnswered,
    lastStudyDate,
    daysSinceStudy: lastStudyDate ? Math.max(0, daysBetween(lastStudyDate, today)) : null,
    phase: studyPhase(totalAnswered, lastStudyDate, today),
    activeExam,
    examDate: typeof userRes.data?.exam_date === "string" ? userRes.data.exam_date.slice(0, 10) : null,
    hitRate,
  };
}
