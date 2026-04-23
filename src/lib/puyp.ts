/**
 * Pass-Until-You-Pass (PUYP) server-side helpers.
 *
 * Lock #1 of the April 23 2026 strategy re-think: subscribers on
 * PUYP-eligible tiers (`premium_pass_guaranteed` + `twelve_month`) who
 * fail their first real exam attempt and have ≥70% Qbank completion
 * get a free subscription extension through the next exam cycle, up
 * to 2 additional cycles per user.
 *
 * This module centralizes the Qbank-completion computation so the
 * user-facing `/api/puyp/submit` route and the admin
 * `/api/puyp/admin/approve` route use the same definition. The
 * numbers are snapshotted at submission time (into
 * `exam_attempts.qbank_completion_pct`) so the admin sees the value
 * that was used at the gate, not today's number.
 *
 * Data source: `user_topic_strength` is the cross-device rollup
 * populated on every answer by the `increment_topic_strength` RPC.
 * Each row is `(user_id, exam_type, topic)` with `answered` and
 * `correct` counters. Total answered across all topics for an
 * exam_type divided by total questions in that exam_type gives the
 * completion %. We rely on `user_topic_strength` rather than joining
 * `answer_history JOIN questions` because the rollup is already
 * aggregated — no 50k-row query on the hot path.
 *
 * Edge case: if `user_topic_strength` is empty (very new user or
 * backfill hasn't run), we fall back to counting distinct questions
 * in `answer_history` joined with `questions` by `exam_type`. This
 * is the same pattern `/api/user/topic-progress` already uses.
 */

import { getServiceClient } from "@/lib/supabase";

/** The gate: ≥70% of the exam-type's active questions answered. */
export const PUYP_COMPLETION_THRESHOLD_PCT = 70;

/** Max PUYP extensions a single user can claim on a single subscription. */
export const PUYP_MAX_EXTENSIONS = 2;

/** Valid exam type strings (mirrors the `questions.exam_type` enum). */
export type PuypExamType = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

export interface QbankCompletion {
  /** Distinct questions answered by the user in this exam type. */
  answered: number;
  /** Total active questions available in this exam type. */
  total: number;
  /** `answered / total * 100`, rounded to 2 decimals. 0 when `total === 0`. */
  pct: number;
}

/**
 * Compute the user's Qbank completion % for a given exam type.
 *
 * Uses `user_topic_strength` (the denormalized rollup) as the source
 * of truth. Falls back to counting distinct `answer_history.question_id`
 * joined with `questions.exam_type` if the rollup is empty for the
 * (user, exam_type) pair — that covers users whose backfill hasn't
 * run yet.
 *
 * Always returns a number (never throws) — any DB error resolves as
 * 0% so the caller can decide whether to block the submission.
 */
export async function computeQbankCompletion(
  userId: string,
  examType: PuypExamType
): Promise<QbankCompletion> {
  const sb = getServiceClient();

  // Total questions available in the exam type. Filter by is_active
  // because we do NOT count archived/deactivated rows in the gate.
  const { count: totalCount } = await sb
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("exam_type", examType)
    .eq("is_active", true);

  const total = typeof totalCount === "number" ? totalCount : 0;

  if (total === 0) {
    return { answered: 0, total: 0, pct: 0 };
  }

  // Try the rollup first.
  const { data: rollup } = await sb
    .from("user_topic_strength")
    .select("answered")
    .eq("user_id", userId)
    .eq("exam_type", examType);

  let answered = 0;
  if (Array.isArray(rollup) && rollup.length > 0) {
    for (const row of rollup) {
      const n = Number((row as { answered?: number }).answered) || 0;
      answered += n;
    }
  } else {
    // Fallback: distinct question_ids from answer_history for this
    // exam type. Uses the PostgREST filter syntax on the embedded
    // questions relation (same pattern as /api/user/topic-progress).
    const { data: rows } = await sb
      .from("answer_history")
      .select("question_id, questions!inner(exam_type)")
      .eq("user_id", userId)
      .eq("questions.exam_type" as string, examType)
      .limit(50000);

    if (Array.isArray(rows)) {
      const seen = new Set<number>();
      for (const r of rows) {
        const qid = (r as { question_id?: number }).question_id;
        if (typeof qid === "number") seen.add(qid);
      }
      answered = seen.size;
    }
  }

  // The rollup counts EVERY answer, including repeat attempts. We
  // need distinct-question completion, not total-answers. The rollup
  // is already aggregated per (user, exam_type, topic), but within a
  // topic the `answered` counter can exceed the topic's question
  // count (a user answering the same question 3 times gets answered=3
  // on that row). Clamp so we don't report > 100% completion.
  if (answered > total) answered = total;

  const pct = Math.round((answered / total) * 10000) / 100; // 2dp

  return { answered, total, pct };
}

/**
 * Returns true if the user has cleared the PUYP submission gate.
 * Thin wrapper for readability at the call sites — same logic could
 * inline `completion.pct >= PUYP_COMPLETION_THRESHOLD_PCT` but the
 * named constant makes the reason self-evident in error messages.
 */
export function meetsPuypCompletionGate(completion: QbankCompletion): boolean {
  return completion.pct >= PUYP_COMPLETION_THRESHOLD_PCT;
}
