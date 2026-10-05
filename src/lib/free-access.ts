/**
 * Server-side free-quota enforcement for EVERY route that serves question
 * content (2026-10-02 paywall hardening, [name]'s explicit ask).
 *
 * The free allowance (SoT §2 "Free tier"): 150 questions per exam type,
 * drawn from the deterministic free slice (`getFreeSliceIds`), counted
 * durably from answer_history. `/api/questions` already enforced it; these
 * side doors did not and served question content for ANY id:
 *   - GET  /api/ai-chat        (cached AI explanation, open even to anon)
 *   - GET/POST /api/translate  (translated stem / explanation)
 *   - POST /api/history/exams  (returned the correct option texts)
 *   - POST /api/notes/transform (note built from the full question)
 *   - POST /api/answer          (a blind answer on an unseen slice id made
 *                                it "answered" and therefore readable)
 *
 * The rule a free (or lapsed / expired / declined-trial) user gets:
 *   a question is accessible iff it is in the free slice of its exam type
 *   AND (the user is under the cap in that exam type OR has already
 *   answered it). Answers made during a trial still count toward the cap
 *   (the count is all distinct answered questions in the exam type; it is
 *   never reset when a trial ends).
 * Guests (no user id) get the slice only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FREE_TIER_QUESTIONS_PER_EXAM,
  getFreeSliceIds,
  isFreeTierEnforced,
  countDistinctAnsweredInExam,
  getAnsweredSliceIds,
} from "@/lib/free-tier";

export interface FreeAccessResult {
  /** Requested ids the caller may read. */
  allowed: Set<number>;
  /** Requested ids that are outside the free allowance. */
  denied: number[];
  /** Exam types in which the caller is at/over the cap. */
  cappedExams: string[];
}

/**
 * Filter `questionIds` down to what a FREE caller may read. Callers must only
 * invoke this for non-paid access (paid/admin bypass happens upstream).
 * Fails CLOSED: unknown/inactive ids are denied.
 */
export async function filterFreeAccessibleQuestions(
  sb: SupabaseClient,
  userId: string | null,
  questionIds: number[]
): Promise<FreeAccessResult> {
  const ids = Array.from(new Set(questionIds.filter((n) => Number.isInteger(n) && n > 0)));
  const allowed = new Set<number>();
  const cappedExams: string[] = [];
  if (ids.length === 0) return { allowed, denied: [], cappedExams };

  const { data, error } = await sb
    .from("questions")
    .select("id, exam_type")
    .in("id", ids)
    .eq("is_active", true);
  if (error) return { allowed, denied: ids, cappedExams };

  const byExam = new Map<string, number[]>();
  for (const row of (data ?? []) as Array<{ id: number; exam_type: string | null }>) {
    const exam = row.exam_type ?? "";
    if (!exam) continue;
    const list = byExam.get(exam) ?? [];
    list.push(row.id);
    byExam.set(exam, list);
  }

  for (const [exam, examIds] of byExam) {
    const slice = await getFreeSliceIds(sb, exam);
    const sliceSet = new Set(slice);
    const inSlice = examIds.filter((id) => sliceSet.has(id));
    if (inSlice.length === 0) continue;

    let capped = false;
    if (userId && isFreeTierEnforced()) {
      const answered = await countDistinctAnsweredInExam(sb, userId, exam);
      capped = answered >= FREE_TIER_QUESTIONS_PER_EXAM;
    }
    if (!capped) {
      inSlice.forEach((id) => allowed.add(id));
      continue;
    }
    cappedExams.push(exam);
    const answeredSlice = await getAnsweredSliceIds(sb, userId as string, slice);
    inSlice.filter((id) => answeredSlice.has(id)).forEach((id) => allowed.add(id));
  }

  return { allowed, denied: ids.filter((id) => !allowed.has(id)), cappedExams };
}

/** Convenience: may a FREE caller read this single question? */
export async function canFreeUserReadQuestion(
  sb: SupabaseClient,
  userId: string | null,
  questionId: number
): Promise<boolean> {
  const r = await filterFreeAccessibleQuestions(sb, userId, [questionId]);
  return r.allowed.has(questionId);
}

// ── Cap-hit server event (previously not instrumented) ──────────────
// One `free_quota_cap_hit` user_event per (user, gate, exam) per hour per
// server instance: enough to count who hits the wall and where, without a
// row per poll. Best-effort, never throws.
const CAP_HIT_THROTTLE_MS = 60 * 60 * 1000;
const capHitSeen = new Map<string, number>();

export async function logFreeCapHit(
  sb: SupabaseClient,
  args: {
    userId: string | null;
    gate: string;
    route: string;
    examType?: string | null;
    seen?: number | null;
    questionId?: number | null;
  }
): Promise<void> {
  if (!args.userId) return;
  const key = `${args.userId}|${args.gate}|${args.examType ?? ""}`;
  const now = Date.now();
  const last = capHitSeen.get(key);
  if (last && now - last < CAP_HIT_THROTTLE_MS) return;
  capHitSeen.set(key, now);
  if (capHitSeen.size > 5000) capHitSeen.clear();
  try {
    await sb.from("user_events").insert({
      user_id: args.userId,
      event_type: "free_quota_cap_hit",
      event_data: {
        gate: args.gate,
        route: args.route,
        exam_type: args.examType ?? null,
        seen: args.seen ?? null,
        limit: FREE_TIER_QUESTIONS_PER_EXAM,
        question_id: args.questionId ?? null,
      },
    });
  } catch (err) {
    console.error("[free-access] cap-hit log failed", err);
  }
}

/** Test hook: reset the per-instance throttle. */
export function __resetCapHitThrottle(): void {
  capHitSeen.clear();
}
