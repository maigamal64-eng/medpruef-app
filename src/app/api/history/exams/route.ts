import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { requireUser, isPaidAccess } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * /api/history/exams — the exam-simulation history (History feature v1).
 *
 * WHY: /exam grades entirely client-side and wrote nothing server-side, so a
 * completed mock exam vanished when its result screen closed (customer
 * feedback id=49, Ahmet, 2026-09-16). exam_simulations is the durable ledger.
 *
 * POST — record a completed attempt. Open to ANY signed-in user: a free
 * user's attempts are recorded too, so the Pro upsell can show real saved
 * data ("3 Prüfungen gespeichert"). Grading is recomputed SERVER-side from
 * the questions table at submission time and snapshotted into `grading`, so
 * later content edits never rewrite history. Never blocks the result screen:
 * on any failure the client keeps the local result.
 *
 * GET — list the caller's attempts, newest first. Pro-only (isPaidAccess):
 * the viewing surface is the paid feature; free callers get 403 + upsell.
 */

interface SubmitBody {
  attempt_id?: string;
  exam_type?: string;
  title?: string;
  config?: Record<string, unknown>;
  question_ids?: unknown;
  answers?: Record<string, unknown>; // qid -> selected OPTION TEXTS (not indices: /api/questions shuffles per load)
  duration_ms?: number;
  started_at?: string;
}

const VALID_EXAM_TYPES = new Set(["kenntnispruefung", "kmp_innsbruck", "pharma"]);
const MAX_QUESTIONS = 400;

interface QRow {
  id: number;
  options?: { correct?: boolean }[] | null;
}

function toSafeInts(v: unknown, max: number, min = 0): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= min && n <= 10_000_000)
    .slice(0, max);
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;
  const sb = getServiceClient();

  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }

  const examType = String(body.exam_type ?? "");
  if (!VALID_EXAM_TYPES.has(examType)) {
    return NextResponse.json({ error: "Unknown exam type" }, { status: 400 });
  }

  const attemptId = body.attempt_id === undefined ? randomUUID() : body.attempt_id;
  if (typeof attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) {
    return NextResponse.json({ error: "Valid attempt_id required" }, { status: 400 });
  }

  // The client uses this stable UUID as the row's existing primary key. If a
  // response was lost after insert, retry returns the original saved record.
  const { data: priorAttempt, error: priorErr } = await sb
    .from("exam_simulations")
    .select("id, correct_count, total_count, score_pct")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle();
  if (priorErr) {
    Sentry.captureException(priorErr, { tags: { route: "history/exams", step: "idempotency_lookup" } });
    return NextResponse.json({ error: "Could not confirm prior attempt" }, { status: 500 });
  }
  if (priorAttempt) {
    return NextResponse.json({ ok: true, attempt: { ...priorAttempt, attempt_id: priorAttempt.id } });
  }

  const questionIds = Array.from(
    new Set(toSafeInts(Array.isArray(body.question_ids) ? body.question_ids : [], MAX_QUESTIONS, 1))
  );
  if (questionIds.length === 0 || questionIds.length > MAX_QUESTIONS) {
    return NextResponse.json({ error: "Invalid question_ids" }, { status: 400 });
  }

  // Buyer input keyed by question id → selected OPTION TEXTS (strings).
  // Texts, not indices: /api/questions shuffles options per load, so client
  // indices are meaningless against the DB's choices order.
  const rawAnswers = (body.answers ?? {}) as Record<string, unknown>;
  const answers: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rawAnswers)) {
    const qid = Number(k);
    if (!Number.isInteger(qid) || qid <= 0) continue;
    if (!Array.isArray(v)) continue;
    const sel = v
      .map((x) => (typeof x === "string" ? x.trim().slice(0, 300) : ""))
      .filter((t) => t.length > 0);
    if (sel.length > 0 && sel.length <= 20) answers[String(qid)] = sel;
  }

  // Server-side grading from the questions table (source of truth at
  // submission time). Same strict rule as the client: the selected-text set
  // must exactly equal the correct-text set (full credit, no partial). A
  // question with no correct option (open-answer or data gap) grades
  // incorrect, matching the client's current isQuestionCorrect behaviour.
  const { data: qRows, error: qErr } = await sb
    .from("questions")
    .select("id, choices")
    .in("id", questionIds);
  if (qErr) {
    Sentry.captureException(qErr, { tags: { route: "history/exams", step: "questions_load" } });
    return NextResponse.json({ error: "Grading failed" }, { status: 500 });
  }
  interface StoredChoice {
    text?: string;
    correct?: boolean;
  }
  const qById = new Map<number, StoredChoice[]>();
  for (const r of (qRows ?? []) as unknown as { id: number; choices?: StoredChoice[] | null }[]) {
    qById.set(r.id, r.choices ?? []);
  }

  const grading: Record<
    string,
    { selected_texts: string[]; correct_texts: string[]; is_correct: boolean }
  > = {};
  let correctCount = 0;
  for (const qid of questionIds) {
    const choices = qById.get(qid) ?? [];
    const selected = answers[String(qid)] ?? [];
    const correctTexts = choices
      .filter((c) => c?.correct === true && typeof c.text === "string")
      .map((c) => (c.text as string).trim());
    const selTrimmed = selected.map((t) => t.trim());
    const isCorrect =
      correctTexts.length > 0 &&
      selTrimmed.length === correctTexts.length &&
      correctTexts.every((t) => selTrimmed.includes(t)) &&
      selTrimmed.every((t) => correctTexts.includes(t));
    grading[String(qid)] = {
      selected_texts: selTrimmed,
      correct_texts: correctTexts,
      is_correct: isCorrect,
    };
    if (isCorrect) correctCount += 1;
  }
  const totalCount = questionIds.length;
  const scorePct = totalCount > 0 ? Math.round((correctCount / totalCount) * 10000) / 100 : 0;

  const nowIso = new Date().toISOString();
  const { data: inserted, error: insErr } = await sb
    .from("exam_simulations")
    .insert({
      id: attemptId,
      user_id: userId,
      exam_type: examType,
      title:
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim().slice(0, 120)
          : null,
      config: (body.config ?? {}) as Record<string, unknown>,
      question_ids: questionIds,
      answers,
      grading,
      correct_count: correctCount,
      total_count: totalCount,
      score_pct: scorePct,
      duration_ms:
        typeof body.duration_ms === "number" && Number.isFinite(body.duration_ms)
          ? Math.min(Math.max(0, Math.round(body.duration_ms)), 4 * 3600_000)
          : null,
      status: "completed",
      started_at:
        typeof body.started_at === "string" && Number.isFinite(Date.parse(body.started_at))
          ? body.started_at
          : null,
      completed_at: nowIso,
    })
    .select("id, correct_count, total_count, score_pct")
    .maybeSingle();

  if (insErr || !inserted) {
    // A parallel retry may have won the same primary-key insert. Confirm its
    // ownership before acknowledging it, and never create a second row.
    if (insErr?.code === "23505") {
      const { data: racedAttempt } = await sb
        .from("exam_simulations")
        .select("id, correct_count, total_count, score_pct")
        .eq("id", attemptId)
        .eq("user_id", userId)
        .maybeSingle();
      if (racedAttempt) {
        return NextResponse.json({ ok: true, attempt: { ...racedAttempt, attempt_id: racedAttempt.id } });
      }
    }
    Sentry.captureException(insErr ?? new Error("insert returned no row"), {
      tags: { route: "history/exams", step: "insert" },
    });
    return NextResponse.json({ error: "Could not save attempt" }, { status: 500 });
  }

  try {
    await sb.from("user_events").insert({
      user_id: userId,
      event_type: "exam_simulation_completed",
      event_data: {
        attempt_id: inserted.id,
        exam_type: examType,
        correct_count: inserted.correct_count,
        total_count: inserted.total_count,
        score_pct: inserted.score_pct,
      },
    });
  } catch {
    /* non-blocking */
  }

  return NextResponse.json({
    ok: true,
    attempt: {
      id: inserted.id,
      attempt_id: inserted.id,
      correct_count: inserted.correct_count,
      total_count: inserted.total_count,
      score_pct: inserted.score_pct,
    },
  });
}

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  // Pro-only viewing surface (the feature itself). Recording stays open so a
  // free user's attempts accumulate and the upsell can quote real data.
  if (!isPaidAccess(guard)) {
    return NextResponse.json({ error: "Pro required", code: "PRO_REQUIRED" }, { status: 403 });
  }
  const { userId } = guard;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const { data, error } = await getServiceClient()
    .from("exam_simulations")
    .select(
      "id, exam_type, title, config, correct_count, total_count, score_pct, duration_ms, completed_at"
    )
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    Sentry.captureException(error, { tags: { route: "history/exams", step: "list" } });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  return NextResponse.json({ attempts: data ?? [] });
}
