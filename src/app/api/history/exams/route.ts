import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { requireUser, isPaidAccess } from "@/lib/auth-guard";
import { filterFreeAccessibleQuestions, logFreeCapHit } from "@/lib/free-access";
import { getServiceClient } from "@/lib/supabase";
import { clampDurationMs, parseAccepted, parseKafAnswers, parseSelfMarks, sanitizeExamConfig } from "@/lib/exam-history-server";

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
 * GET — list the caller's attempts, newest first. Pro callers get the full
 * row; free and lapsed callers get a read-only summary (date, title, score,
 * counts) and never config or answers (pick-ux-exm-38 B, [name] 12 Oct). The
 * detail route stays Pro-only.
 *
 * a24: `config` is whitelisted (sanitizeExamConfig), the stored duration is
 * clamped to the run's own clock, KAF runs (kind "kaf") are self-marked
 * against the reviewed kaf_items pool (Pro and KAF_TIMED_ENABLED only), and
 * EXAM_MISSES_TO_REVIEW_ENABLED (default OFF) schedules a Pro learner's wrong
 * and open items in user_question_progress. Exam answers never write
 * answer_history.
 */

interface SubmitBody {
  attempt_id?: string;
  exam_type?: string;
  title?: string;
  config?: Record<string, unknown>;
  question_ids?: unknown;
  answers?: Record<string, unknown>; // qid -> selected OPTION TEXTS (not indices: /api/questions shuffles per load)
  /** KAF runs only: qid -> true when the learner marked the typed answer as right. */
  self_marks?: Record<string, unknown>;
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

  // 2026-10-02 paywall: the response carries the correct option texts, so a
  // free caller may only submit questions inside their free allowance (the
  // same set /api/questions would have served them). Otherwise this POST was
  // an answer-key oracle for any question id.
  if (!isPaidAccess(guard)) {
    const access = await filterFreeAccessibleQuestions(sb, userId, questionIds);
    if (access.denied.length > 0) {
      await logFreeCapHit(sb, {
        userId,
        gate: "mock_exam",
        route: "/api/history/exams POST",
        examType: examType,
      });
      return NextResponse.json(
        { error: "Pro required", code: "PRO_REQUIRED", upgradeRequired: true, gate: "qbank_limit" },
        { status: 402 }
      );
    }
  }

  const config = sanitizeExamConfig(body.config, questionIds);
  const grading: Record<
    string,
    { selected_texts: string[]; correct_texts: string[]; is_correct: boolean }
  > = {};
  let correctCount = 0;
  let answers: Record<string, string[]> = {};

  if (config.kind === "kaf") {
    // KAF (SIM-04): Pro only and dark until KAF_TIMED_ENABLED. Every item must
    // come from the reviewed pool; the learner's own marks are the score, the
    // accepted wording is snapshotted for review.
    if (process.env.KAF_TIMED_ENABLED !== "true") {
      return NextResponse.json({ error: "KAF mode unavailable", code: "KAF_DISABLED" }, { status: 403 });
    }
    if (!isPaidAccess(guard)) {
      return NextResponse.json({ error: "Pro required", code: "PRO_REQUIRED" }, { status: 403 });
    }
    const { data: kafRows, error: kafErr } = await sb
      .from("kaf_items")
      .select("question_id, accepted")
      .in("question_id", questionIds);
    if (kafErr) {
      Sentry.captureException(kafErr, { tags: { route: "history/exams", step: "kaf_load" } });
      return NextResponse.json({ error: "Grading failed" }, { status: 500 });
    }
    const accepted = new Map<number, string[][]>();
    for (const r of (kafRows ?? []) as { question_id: number; accepted: unknown }[]) accepted.set(r.question_id, parseAccepted(r.accepted));
    if (questionIds.some((id) => !accepted.get(id)?.length)) {
      return NextResponse.json({ error: "Item not in the reviewed pool" }, { status: 400 });
    }
    answers = parseKafAnswers(body.answers, questionIds);
    const marks = parseSelfMarks(body.self_marks, answers);
    for (const qid of questionIds) {
      const isCorrect = marks[String(qid)] === true;
      grading[String(qid)] = {
        selected_texts: answers[String(qid)] ?? [],
        correct_texts: (accepted.get(qid) ?? []).map((alts) => alts[0]),
        is_correct: isCorrect,
      };
      if (isCorrect) correctCount += 1;
    }
  } else {
  // Buyer input keyed by question id → selected OPTION TEXTS (strings).
  // Texts, not indices: /api/questions shuffles options per load, so client
  // indices are meaningless against the DB's choices order.
  const rawAnswers = (body.answers ?? {}) as Record<string, unknown>;
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
      config: config as unknown as Record<string, unknown>,
      question_ids: questionIds,
      answers,
      grading,
      correct_count: correctCount,
      total_count: totalCount,
      score_pct: scorePct,
      duration_ms: clampDurationMs(body.duration_ms, config),
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

  // pick-ux-exm-30 A: wrong and open items of a Pro learner's run become due
  // reviews, behind EXAM_MISSES_TO_REVIEW_ENABLED (default OFF). Only the
  // schedule table is touched; answer_history and the free cap stay as they are.
  if (process.env.EXAM_MISSES_TO_REVIEW_ENABLED === "true" && config.kind === "mcq" && isPaidAccess(guard)) {
    const missed = questionIds.filter((qid) => !grading[String(qid)]?.is_correct);
    if (missed.length > 0) {
      try {
        const now = new Date().toISOString();
        await sb.from("user_question_progress").upsert(
          missed.map((question_id) => ({ user_id: userId, question_id, next_review_at: now })),
          { onConflict: "user_id,question_id", ignoreDuplicates: true },
        );
        await sb.from("user_question_progress").update({ next_review_at: now })
          .eq("user_id", userId).in("question_id", missed).gt("next_review_at", now);
      } catch (error) {
        Sentry.captureException(error, { tags: { route: "history/exams", step: "misses_to_review" } });
      }
    }
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

  // Pro callers get the full list; free and lapsed callers a read-only
  // summary (pick-ux-exm-38 B). The detail route stays Pro-only.
  const paid = isPaidAccess(guard);
  const { userId } = guard;

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const { data, error, count } = await getServiceClient()
    .from("exam_simulations")
    .select(
      paid
        ? "id, exam_type, title, config, correct_count, total_count, score_pct, duration_ms, completed_at"
        : "id, exam_type, title, correct_count, total_count, score_pct, completed_at",
      { count: "exact" }
    )
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    Sentry.captureException(error, { tags: { route: "history/exams", step: "list" } });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  return NextResponse.json({ attempts: data ?? [], total: count, access: paid ? "full" : "summary" });
}
