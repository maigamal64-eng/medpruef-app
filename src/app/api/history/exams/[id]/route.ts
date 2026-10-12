import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser, isPaidAccess } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/history/exams/[id] — full review payload for ONE saved exam
 * simulation (History feature v1). Pro-only + owner-checked.
 *
 * Grading is TEXT-based (2026-09-20): /api/questions shuffles options per
 * load, so the ledger stores selected/correct OPTION TEXTS. The review view
 * therefore renders DB choices in stable position order and marks each
 * option as "selected" / "correct" by text membership — immune to shuffles
 * and later content edits. Questions since removed from the bank render as
 * removed without breaking the review.
 */

interface StoredChoice {
  text?: string;
  correct?: boolean;
  position?: number;
}

interface SimRow {
  id: string;
  user_id: string;
  exam_type: string;
  title: string | null;
  config: Record<string, unknown> | null;
  question_ids: number[];
  answers: Record<string, string[]> | null;
  grading: Record<
    string,
    { selected_texts: string[]; correct_texts: string[]; is_correct: boolean }
  > | null;
  correct_count: number;
  total_count: number;
  score_pct: number;
  duration_ms: number | null;
  status: string;
  started_at: string | null;
  completed_at: string;
}

interface QRow {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string | null;
  ai_explanation: string | null;
  choices: StoredChoice[] | null;
  image_url: string | null;
  is_active: boolean;
  exam_type: string;
}

async function handleGET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  if (!isPaidAccess(guard)) {
    return NextResponse.json({ error: "Pro required", code: "PRO_REQUIRED" }, { status: 403 });
  }
  const { userId } = guard;

  const { id } = await ctx.params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data: sim, error: simErr } = await sb
    .from("exam_simulations")
    .select(
      "id, user_id, exam_type, title, config, question_ids, answers, grading, correct_count, total_count, score_pct, duration_ms, status, started_at, completed_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (simErr) {
    Sentry.captureException(simErr, { tags: { route: "history/exams/[id]", step: "load" } });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  if (!sim) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Owner check — never serve one user's attempt to another. 404 (not 403)
  // so another user's attempt ids are indistinguishable from missing ones.
  const row = sim as SimRow;
  if (row.user_id !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Join the questions fresh from the bank, chunked (REST `in (...)` is
  // unreliable at large sizes).
  const qids = Array.from(
    new Set((row.question_ids ?? []).filter((n) => Number.isInteger(n) && n > 0))
  ).slice(0, 400);
  const questionsById = new Map<number, QRow>();
  for (let i = 0; i < qids.length; i += 80) {
    const chunk = qids.slice(i, i + 80);
    const { data: qRows, error: qErr } = await sb
      .from("questions")
      .select(
        "id, topic, question, answer, explanation, ai_explanation, choices, image_url, is_active, exam_type"
      )
      .in("id", chunk);
    if (qErr) {
      Sentry.captureException(qErr, { tags: { route: "history/exams/[id]", step: "questions_load" } });
      return NextResponse.json({ error: "Question lookup failed" }, { status: 500 });
    }
    for (const q of (qRows ?? []) as unknown as QRow[]) {
      questionsById.set(q.id, q);
    }
  }

  const questions = qids.map((qid) => {
    const q = questionsById.get(qid);
    const g = row.grading?.[String(qid)] ?? null;
    const selectedTexts = g?.selected_texts ?? row.answers?.[String(qid)] ?? [];
    const correctTexts = g?.correct_texts ?? [];
    const isCorrect = g?.is_correct ?? false;

    if (!q) {
      return {
        question_id: qid,
        removed: true,
        is_correct: isCorrect,
        selected_texts: selectedTexts,
        correct_texts: correctTexts,
        options: [] as Array<{ text: string; is_correct: boolean; is_selected: boolean }>,
      };
    }

    // Stable display order: by stored position, falling back to input order.
    const sorted = [...(q.choices ?? [])].sort(
      (a, b) => (a?.position ?? 99) - (b?.position ?? 99)
    );
    const options = sorted
      .filter((c) => typeof c?.text === "string" && (c.text as string).trim().length > 0)
      .map((c) => ({
        text: (c.text as string).trim(),
        is_correct: correctTexts.length > 0
          ? correctTexts.includes((c.text as string).trim())
          : c?.correct === true,
        is_selected: selectedTexts.includes((c.text as string).trim()),
      }));

    return {
      question_id: qid,
      removed: false,
      topic: q.topic,
      stem: q.question,
      options,
      is_correct: isCorrect,
      selected_texts: selectedTexts,
      correct_texts: correctTexts,
      explanation: q.explanation ?? null,
      ai_explanation: q.ai_explanation ?? null,
      image_url: q.image_url ?? null,
      is_active: q.is_active,
    };
  });

  return NextResponse.json({
    attempt: {
      id: row.id,
      exam_type: row.exam_type,
      title: row.title,
      config: row.config,
      // a24 (UX-EXM-39 'Markiert'): ids the learner flagged during the run,
      // restricted to this attempt's questions. Legacy rows have none.
      flagged_ids: Array.isArray(row.config?.flagged_ids)
        ? Array.from(new Set((row.config.flagged_ids as unknown[]).map(Number)))
            .filter((n) => Number.isInteger(n) && n > 0 && qids.includes(n))
        : [],
      correct_count: row.correct_count,
      total_count: row.total_count,
      score_pct: row.score_pct,
      duration_ms: row.duration_ms,
      status: row.status,
      started_at: row.started_at,
      completed_at: row.completed_at,
    },
    questions,
  });
}

export const GET = withDbUnavailable(handleGET);
