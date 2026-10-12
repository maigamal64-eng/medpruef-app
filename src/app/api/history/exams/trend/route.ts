import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser, isPaidAccess } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { buildExamTrend, type TrendAttemptInput } from "@/lib/exam-trend";

export const dynamic = "force-dynamic";

/** Newest full runs read for the trend; the series shows at most six. */
const MAX_ATTEMPTS = 60;
const ID_CHUNK = 400;

/**
 * GET /api/history/exams/trend (a25, INF-04): per-subject score history of
 * the learner's own full mock exams, the gap to 60 percent and the number of
 * full runs. Pro only (history detail is Pro), owner-scoped by the signed
 * session. Subjects are joined from questions.topic at read time; removed
 * questions are left out. Counts only, never question content.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!isPaidAccess(guard)) {
    return NextResponse.json({ error: "Pro required", code: "PRO_REQUIRED" }, { status: 403 });
  }
  const sb = getServiceClient();
  try {
    const { data: rows, error } = await sb
      .from("exam_simulations")
      .select("id, exam_type, config, question_ids, grading, completed_at")
      .eq("user_id", guard.userId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(MAX_ATTEMPTS);
    if (error) throw error;

    const attempts: TrendAttemptInput[] = (rows || []).map((r) => ({
      id: String(r.id),
      completedAt: String(r.completed_at),
      examType: String(r.exam_type),
      config: r.config && typeof r.config === "object" ? (r.config as Record<string, unknown>) : null,
      questionIds: Array.isArray(r.question_ids) ? (r.question_ids as unknown[]).filter((n): n is number => typeof n === "number") : [],
      grading: r.grading && typeof r.grading === "object" ? (r.grading as TrendAttemptInput["grading"]) : null,
    }));

    const ids = Array.from(new Set(attempts.flatMap((a) => a.questionIds)));
    const topicById = new Map<number, string>();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data: qs, error: qErr } = await sb.from("questions").select("id, topic").in("id", ids.slice(i, i + ID_CHUNK));
      if (qErr) throw qErr;
      for (const q of qs || []) if (typeof q.topic === "string") topicById.set(Number(q.id), q.topic);
    }

    return NextResponse.json(buildExamTrend(attempts, topicById));
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "/api/history/exams/trend" } });
    return NextResponse.json({ error: "Failed to load trend" }, { status: 500 });
  }
}
