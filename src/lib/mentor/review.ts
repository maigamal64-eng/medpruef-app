/** Canonical quality sample, separate from transient model history. Retained 30 days. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorChatRequest, MentorFinalEvent } from "./contract";
import { turnOutcome } from "./outcomes";

export function makeReviewSnapshot(args: { requestId: string; userId: string; request: MentorChatRequest; final: MentorFinalEvent }) {
  return {
    request_id: args.requestId, user_id: args.userId, conversation_id: args.final.conversation_id,
    question_text: args.request.message.slice(0, 8000),
    answer_text: args.final.answer_blocks.map(b => b.text).join("\n\n").slice(0, 24000),
    lang: args.request.lang, outcome: turnOutcome(args.final),
    citations: args.final.citations.slice(0, 60).map(c => ({ fact_id: c.fact_id, read_on: c.read_on, source_url: c.source_url })),
  };
}
export async function recordReviewSnapshot(db: SupabaseClient, args: Parameters<typeof makeReviewSnapshot>[0]): Promise<void> {
  const { error } = await db.from("ai_mentor_review").upsert(makeReviewSnapshot(args), { onConflict: "request_id", ignoreDuplicates: true });
  if (error) throw new Error("mentor review snapshot write failed");
}
export const REVIEW_VERDICTS = ["accept", "wrong", "needs_fact_change"] as const;
export type ReviewVerdict = typeof REVIEW_VERDICTS[number];
export interface MentorReviewItem {
  request_id: string; conversation_id: string; question_text: string; answer_text: string;
  lang: string; outcome: string; created_at: string; category: string;
  citations: Array<{ fact_id: string; read_on: string; source_url: string }>;
  verdict: ReviewVerdict | null;
}
export function parseReviewVerdict(body: unknown): { requestId: string; verdict: ReviewVerdict } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.request_id) || !REVIEW_VERDICTS.includes(b.verdict as ReviewVerdict)) return null;
  return { requestId: b.request_id, verdict: b.verdict as ReviewVerdict };
}
