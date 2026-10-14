import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { canFreeUserReadQuestion, logFreeCapHit } from "@/lib/free-access";
import { captureServerError } from "@/lib/sentry-capture";
import { qualifyReferralOnActivity } from "@/lib/referral-exam-reward";
import { parseGrade, parseKind, readAnswerFlags, resolveAnswerPath, skipSchedule } from "@/lib/answer-request";
import { dbUnavailableResponse, withDbUnavailable } from "@/lib/db-unavailable-route";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { checkAnswerKey, readAnswerKeyGuardMode, rowKeyFingerprint, QUESTION_CHANGED_ERROR } from "@/lib/answer-key-fingerprint";
import { reportKeyMismatch } from "@/lib/answer-key-report";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/answer
 *
 * Record an answer, update spaced-rep progress, award XP, bump streak.
 *
 * Auth: `requireUser` — the userId comes from the `x-user-id` header
 * (verified against the users table), NOT from the body. Any body-
 * supplied `userId` is ignored. This closes BE-P0-003 / SEC-P0 from
 * the 2026-04-15 audit (client-trust on a hot mutating path).
 *
 * Error handling: every write is now checked. Previously errors were
 * silently swallowed, which caused the "daily goal stuck at 0" /
 * "XP didn't save" class of bugs. See BE-P0-005 in 03-backend-api.md.
 *
 * The answer history, spaced repetition, gamification, user totals, and
 * topic-strength counters are written by one Postgres transaction. The
 * client request ID makes a retry safe if the response was lost.
 */
async function handlePOST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  // Tier-aware branches. Free users still record answers + XP on
  // free-slice questions (so signup still feels rewarding), but they
  // DON'T get spaced-repetition scheduling — that's Pro. This matches
  // the Lock 2026-04-23 gating decision: bookmarks, notes, mock exam,
  // SR, and wrong-only practice are Pro-only. The questions route
  // already gates fetches; /api/answer only has to skip the SR write.
  //
  // 2026-04-24: switched from `isFreeTier(tier)` to `isFreeAccess(guard)`
  // so admins (role='admin', tier='free' possible) retain full SR
  // scheduling. Fixes the case where /admin/ operators testing the
  // product lost their spaced-rep history because the system treated
  // them as free.
  const isFreeUser = isFreeAccess(guard);

  let body: { questionId?: number; isCorrect?: boolean; userAnswer?: string; timeSpentMs?: number; requestId?: string; grade?: unknown; kind?: unknown; keyFingerprint?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { questionId, isCorrect, userAnswer, timeSpentMs, requestId } = body;
  if (requestId !== undefined && (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))) {
    return NextResponse.json({ error: "Invalid requestId" }, { status: 400 });
  }
  // a23: optional 0..3 grade and answer kind. With every flag off (default)
  // they are validated and otherwise ignored, so the stored result is the
  // same binary quiz answer as before.
  const grade = parseGrade(body.grade);
  const kind = parseKind(body.kind);
  if (grade === null) return NextResponse.json({ error: "grade must be 0, 1, 2 or 3" }, { status: 400 });
  if (kind === null) return NextResponse.json({ error: "kind must be quiz or flashcard" }, { status: 400 });
  const flags = readAnswerFlags(process.env);
  const path = resolveAnswerPath(kind, grade, flags);
  if (path === "flashcard" && !requestId) {
    return NextResponse.json({ error: "requestId required for a flashcard review" }, { status: 400 });
  }
  if (path !== "quiz" && grade !== undefined && typeof isCorrect === "boolean" && isCorrect !== (grade >= 2)) {
    return NextResponse.json({ error: "grade and isCorrect disagree" }, { status: 400 });
  }

  if (typeof questionId !== "number" || (path !== "flashcard" && typeof isCorrect !== "boolean")) {
    return NextResponse.json({ error: "questionId (number) and isCorrect (boolean) required" }, { status: 400 });
  }
  const noSchedule = skipSchedule(isFreeUser, flags);

  // Top-level try/catch wraps the atomic write and ancillary effects. Any unexpected
  // throw (DB connectivity blip, RPC timeout, etc.) captures to Sentry
  // with userId + questionId attached, then returns a sanitized 500 so
  // we don't leak stack traces to the client. Per-write errors below
  // are still logged individually for finer-grained debugging.
  try {
  const sb = getServiceClient();

  // Validate the question before recording it. The RPC repeats the active
  // check in the same transaction to close the deactivation race. The key
  // columns ride on the same read (a-fo-07: no extra round trip).
  const { data: question, error: qErr } = await sb
    .from("questions")
    .select("difficulty, topic, exam_type, answer, choices, distractors")
    .eq("id", questionId)
    .eq("is_active", true)
    .maybeSingle();
  if (qErr) {
    console.error("[answer] question lookup:", qErr);
    return NextResponse.json({ error: "Question lookup failed" }, { status: 500 });
  }
  if (!question) {
    return NextResponse.json({ error: "Unknown question" }, { status: 404 });
  }
  // a-fo-07 stale-key guard. Quiz answers only (record_quiz_answer): graded
  // self-ratings and flashcards carry no answer key. The client's isCorrect
  // stays the verdict of record whenever its key is current (audit rule 6).
  const keyMode = readAnswerKeyGuardMode(process.env);
  if (keyMode !== "off" && path === "quiz" && kind !== "flashcard" && grade === undefined) {
    const keyCheck = checkAnswerKey({
      mode: keyMode,
      sent: body.keyFingerprint,
      current: rowKeyFingerprint(questionId, question as { answer?: string | null; choices?: unknown; distractors?: unknown }),
      enforcedAt: process.env.ANSWER_KEY_GUARD_ENFORCED_AT,
    });
    if (keyCheck.verdict === "mismatch") {
      reportKeyMismatch(questionId, keyMode);
      if (keyCheck.refuse) return NextResponse.json({ error: QUESTION_CHANGED_ERROR }, { status: 409 });
    } else if (keyCheck.verdict === "legacy_accept") {
      // Shadow evidence: share of answers still sent by pre-deploy tabs or outbox rows.
      console.info("[answer] key_missing", { questionId });
    } else if (keyCheck.verdict === "legacy_refuse") {
      console.warn("[answer] key_missing_refused", { questionId });
      return NextResponse.json({ error: QUESTION_CHANGED_ERROR }, { status: 409 });
    }
  }
  // 2026-10-02 paywall: a free caller may only record answers for questions
  // inside their free allowance. Without this, a blind POST on an unseen
  // slice id marked it "answered" and so unlocked it past the cap. A repeat
  // answer on an already-answered question stays allowed.
  if (isFreeUser && !(await canFreeUserReadQuestion(sb, userId, questionId))) {
    await logFreeCapHit(sb, {
      userId,
      gate: "qbank_limit",
      route: "/api/answer",
      examType: (question as { exam_type?: string | null }).exam_type ?? null,
      questionId,
    });
    return NextResponse.json(
      { error: "Pro only", upgradeRequired: true, gate: "qbank_limit" },
      { status: 402 }
    );
  }

  // a-stability: a flashcard rating can be replayed from the device outbox
  // after FLASHCARD_REVIEW_KIND_ENABLED flipped. The two recorders keep their
  // idempotency keys in different tables (flashcard_reviews vs answer_history),
  // so look for the key in the table of the path NOT taken: a hit means the
  // rating already counted and the replay is a duplicate (never a second XP).
  if (kind === "flashcard" && requestId) {
    const otherTable = path === "flashcard" ? "answer_history" : "flashcard_reviews";
    const { data: prior, error: priorErr } = await sb
      .from(otherTable)
      .select("question_id")
      .eq("user_id", userId)
      .eq("client_request_id", requestId)
      .maybeSingle();
    // flashcard_reviews may not exist before the a23 changeset: no prior row.
    const missingTable = priorErr && (priorErr.code === "42P01" || priorErr.code === "PGRST205");
    if (priorErr && !missingTable) throw new Error("Flashcard idempotency check failed", { cause: priorErr });
    if (prior) {
      if ((prior as { question_id?: number }).question_id !== questionId) {
        return NextResponse.json({ error: "Request already used for another answer" }, { status: 409 });
      }
      return NextResponse.json({
        saved: true, duplicate: true, ...(path === "flashcard" ? { kind: "flashcard" } : {}),
        xp: 0, totalXp: null, gamification: null, cardsToday: null, review: null,
      });
    }
  }

  // Flashcard review kind (pick-ux-pra-59 A): schedule and review log only.
  if (path === "flashcard" && grade !== undefined && requestId) {
    const { data: reviewed, error: reviewErr } = await sb.rpc("record_flashcard_review", {
      p_user_id: userId,
      p_question_id: questionId,
      p_grade: grade,
      p_request_id: requestId,
      p_schedule: !noSchedule,
      p_graded: flags.srsGrade,
    });
    if (reviewErr) {
      console.error("[answer] flashcard review RPC:", reviewErr);
      if (reviewErr.message?.includes("QUESTION_UNAVAILABLE")) {
        return NextResponse.json({ error: "Question is no longer available" }, { status: 409 });
      }
      if (reviewErr.message?.includes("IDEMPOTENCY_KEY_CONFLICT")) {
        return NextResponse.json({ error: "Request already used for another answer" }, { status: 409 });
      }
      throw new Error("Flashcard review could not be saved", { cause: reviewErr });
    }
    const card = reviewed as { saved?: boolean; duplicate?: boolean; scheduled?: boolean; intervalDays?: number | null; nextReviewAt?: string | null; cardsToday?: number; gamification?: Record<string, unknown> | null };
    if (!card?.saved) throw new Error("Flashcard review was not confirmed");
    const days = card.intervalDays;
    return NextResponse.json({
      saved: true,
      duplicate: Boolean(card.duplicate),
      kind: "flashcard",
      xp: 0,
      totalXp: (card.gamification as { total_xp?: number } | null)?.total_xp ?? null,
      gamification: card.gamification ?? null,
      cardsToday: Number.isFinite(Number(card.cardsToday)) ? Number(card.cardsToday) : null,
      // No schedule promise to free accounts, even when FREE_SCHEDULE_ENABLED writes one.
      review: !isFreeUser && card.scheduled && typeof days === "number" && Number.isFinite(days)
        ? { intervalDays: days, nextReviewAt: card.nextReviewAt ?? null }
        : null,
    });
  }

  const { data: recorded, error: recordErr } = path === "graded" && grade !== undefined
    ? await sb.rpc("record_graded_answer", {
        p_user_id: userId,
        p_question_id: questionId,
        p_grade: grade,
        p_request_id: requestId || null,
        p_is_free: noSchedule,
        p_user_answer: userAnswer || null,
        p_time_spent_ms: timeSpentMs || null,
      })
    : await sb.rpc("record_quiz_answer", {
        p_user_id: userId,
        p_question_id: questionId,
        p_is_correct: isCorrect as boolean,
        p_user_answer: userAnswer || null,
        p_time_spent_ms: timeSpentMs || null,
        p_is_free: noSchedule,
        p_request_id: requestId || null,
      });
  if (recordErr) {
    console.error("[answer] atomic answer RPC:", recordErr);
    if (recordErr.message?.includes("QUESTION_UNAVAILABLE")) {
      return NextResponse.json({ error: "Question is no longer available" }, { status: 409 });
    }
    if (recordErr.message?.includes("IDEMPOTENCY_KEY_CONFLICT")) {
      return NextResponse.json({ error: "Request already used for another answer" }, { status: 409 });
    }
    throw new Error("Answer could not be saved", { cause: recordErr });
  }
  const result = recorded as { saved?: boolean; duplicate?: boolean; xp?: number; totalXp?: number; gamification?: Record<string, unknown> | null };
  if (!result?.saved) throw new Error("Answer save was not confirmed");
  const xp = result.xp ?? 0;
  const updatedGam = result.gamification ?? null;

  // These are ancillary signals. Their helpers are best-effort and never
  // affect the saved answer or its counters.
  if (!result.duplicate) {
    try { await qualifyReferralOnActivity(sb, userId); }
    catch (referralErr) { console.error("[answer] referral exam-reward qualification:", referralErr); }
    try {
      await sb.rpc("increment_user_announcements_qs", { p_user_id: userId });
    } catch (announceErr) {
      console.error("[answer] user_announcements bump:", announceErr);
    }
  }

  // UX-GLOBAL-34: the rating tray shows the server's real schedule after a
  // tap, never an invented interval. Free accounts have no schedule (the RPC
  // skips user_question_progress for them), so `review` is null. Best-effort:
  // a failed read never affects the saved answer.
  let review: { intervalDays: number; nextReviewAt: string | null } | null = null;
  if (!isFreeUser) {
    try {
      const { data: progress } = await sb
        .from("user_question_progress")
        .select("interval_days, next_review_at")
        .eq("user_id", userId)
        .eq("question_id", questionId)
        .maybeSingle();
      if (progress && Number.isFinite(Number(progress.interval_days))) {
        review = { intervalDays: Number(progress.interval_days), nextReviewAt: progress.next_review_at ?? null };
      }
    } catch (progressErr) {
      console.error("[answer] review schedule read:", progressErr);
    }
  }

  return NextResponse.json({
    saved: true,
    duplicate: Boolean(result.duplicate),
    xp,
    totalXp: result.totalXp ?? null,
    gamification: updatedGam,
    review,
  });

  } catch (err) {
    // A database outage becomes 503 + Retry-After; the device outbox retries
    // it with the same request id. This includes the free-allowance check
    // (a-db-relief-1, skeptic HIGH): a brownout there used to answer 402,
    // which the quiz and the outbox treat as final, so the answer was lost.
    // Only real defects go to Sentry (no flood during a freeze).
    if (isDbUnavailable(err)) return dbUnavailableResponse();
    captureServerError(err, {
      route: "/api/answer",
      userId,
      questionId,
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const POST = withDbUnavailable(handlePOST);
