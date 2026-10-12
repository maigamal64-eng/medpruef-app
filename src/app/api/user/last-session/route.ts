import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/user/last-session
 *
 * Derives the user's most recent practice session from answer_history:
 * - Latest answered row gives us the last topic + exam_type
 * - "Session" = rows within ±2h of that latest row (group detection)
 * - Suggest next question: first spaced-rep due question in that topic,
 *   else first unseen active question in that topic
 *
 * Response: 204 if no history. Otherwise JSON with the resume context.
 *
 * Powers the <ResumeSessionCard> on the home dashboard — addresses
 * Abobaker's survey feedback ("if I could start from where I left
 * yesterday it will be great").
 */
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const sb = getServiceClient();

  // Latest answered question with joined topic + exam_type
  const { data: last, error: lastErr } = await sb
    .from("answer_history")
    .select(
      `
      question_id,
      created_at,
      questions!inner(id, topic, exam_type)
      `
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) {
    console.error("[last-session] latest row:", lastErr);
    return NextResponse.json(
      { error: "Failed to load last session" },
      { status: 500 }
    );
  }

  if (!last) {
    // No answer history yet — return 204 so the client hides the card
    return new NextResponse(null, { status: 204 });
  }

  // Supabase returns joined rows as an object for 1:1 inner joins. Handle both shapes defensively.
  const joined = last.questions as unknown as
    | { id: number; topic: string; exam_type: string }
    | Array<{ id: number; topic: string; exam_type: string }>
    | null;
  const q = Array.isArray(joined) ? joined[0] : joined;
  if (!q) {
    return new NextResponse(null, { status: 204 });
  }

  const lastActiveAt = last.created_at as string;
  const lastQuestionId = last.question_id as number;
  const topic = q.topic;
  const examType = q.exam_type;

  const lastTs = new Date(lastActiveAt).getTime();
  const staleDays = Math.floor((Date.now() - lastTs) / (24 * 3600 * 1000));

  // Count session size: answers within ±2h of lastTs
  const windowStart = new Date(lastTs - 2 * 3600 * 1000).toISOString();
  const windowEnd = new Date(lastTs + 2 * 3600 * 1000).toISOString();
  const { count: sessionCount } = await sb
    .from("answer_history")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", windowStart)
    .lte("created_at", windowEnd);

  // Suggest next question: prefer spaced-rep due in same topic, else first unseen in topic
  let suggestedQuestionId: number | null = null;
  const nowIso = new Date().toISOString();
  const { data: due } = await sb
    .from("user_question_progress")
    .select("question_id, questions!inner(topic, exam_type, is_active)")
    .eq("user_id", userId)
    .lte("next_review_at", nowIso)
    .limit(30);
  if (due && due.length > 0) {
    for (const row of due) {
      const j = row.questions as unknown as
        | { topic: string; exam_type: string; is_active: boolean }
        | Array<{ topic: string; exam_type: string; is_active: boolean }>;
      const info = Array.isArray(j) ? j[0] : j;
      if (info?.topic === topic && info.is_active) {
        suggestedQuestionId = row.question_id as number;
        break;
      }
    }
  }

  if (!suggestedQuestionId) {
    // Fallback: first unseen question in topic
    const { data: answered } = await sb
      .from("answer_history")
      .select("question_id")
      .eq("user_id", userId);
    const seenIds = new Set((answered || []).map((r) => r.question_id));
    const { data: candidates } = await sb
      .from("questions")
      .select("id")
      .eq("topic", topic)
      .eq("exam_type", examType)
      .eq("is_active", true)
      .limit(50);
    const next = (candidates || []).find((c) => !seenIds.has(c.id));
    if (next) suggestedQuestionId = next.id as number;
  }

  return NextResponse.json({
    hasSession: true,
    topic,
    examType,
    questionsInSession: sessionCount || 1,
    lastActiveAt,
    lastQuestionId,
    suggestedQuestionId,
    staleDays,
  });
}

export const GET = withDbUnavailable(handleGET);
