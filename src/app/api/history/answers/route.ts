import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser, isPaidAccess } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/history/answers — browse the caller's own answer history
 * (History feature v1, the "Fragen-Verlauf" tab). Pro-only.
 *
 * Paginated, newest first, joined with the live question content via the
 * answer_history_question_id_fkey (verified 2026-09-20). Filters: exam_type,
 * topic, correctness (correct|wrong), answered-within days. Deactivated or
 * removed questions still show (is_active flag drives a "aus dem Fragenpool
 * entfernt" chip); the learner's own answer snapshot is theirs forever.
 */

const VALID_EXAM_TYPES = ["kenntnispruefung", "kmp_innsbruck", "pharma"] as const;

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  if (!isPaidAccess(guard)) {
    return NextResponse.json({ error: "Pro required", code: "PRO_REQUIRED" }, { status: 403 });
  }
  const { userId } = guard;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 50);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
  const examType = url.searchParams.get("exam_type") ?? "";
  const topic = url.searchParams.get("topic") ?? "";
  const correctness = url.searchParams.get("correctness") ?? "";
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 0) || 0, 0), 365);

  const sb = getServiceClient();

  let q = sb
    .from("answer_history")
    .select(
      "id, question_id, user_answer, is_correct, time_spent_ms, created_at, questions!left(id, topic, question, answer, explanation, ai_explanation, choices, image_url, is_active, exam_type)",
      { count: "exact" }
    )
    .eq("user_id", userId);

  if ((VALID_EXAM_TYPES as readonly string[]).includes(examType)) {
    q = q.eq("questions.exam_type", examType);
  }
  if (topic) q = q.eq("questions.topic", topic);
  if (correctness === "correct") q = q.eq("is_correct", true);
  if (correctness === "wrong") q = q.eq("is_correct", false);
  if (days > 0) {
    q = q.gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
  }

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    Sentry.captureException(error, { tags: { route: "history/answers", step: "list" } });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  return NextResponse.json({
    answers: data ?? [],
    total: count ?? null,
  });
}