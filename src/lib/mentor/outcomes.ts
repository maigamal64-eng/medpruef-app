import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorChatRequest, MentorErrorCode, MentorFinalEvent, MentorTurnOutcome } from "./contract";
import { isFallbackOnlyText } from "./prompt/refusals";

export interface MentorTurnRow {
  request_id: string; user_id: string; conversation_id: string | null; created_at: string;
  entry: string; channel: string; lang: string; mode: string; question_id: number | null;
  outcome: MentorTurnOutcome; refusal_reason: string | null; replaced_count: number;
  calls: number; retries: number; latency_ms: number; charged: boolean;
  charged_micro: number; house_micro: number; fact_ids: string[];
  next_actions_shown: string[]; next_action_clicked: string | null;
  hint_used: boolean; solution_shown: boolean; cold_cache: boolean;
}

export function turnOutcome(final: MentorFinalEvent | null, error?: MentorErrorCode): MentorTurnOutcome {
  if (error === "credits_required" || error === "credits_exhausted") return "blocked_402";
  if (error === "rate_limited") return "blocked_429";
  if (error === "global_cap") return "blocked_cap";
  if (!final) return "error";
  if (final.refused) return "refused";
  if (final.answer_blocks.every((b) => isFallbackOnlyText(b.text))) return "notice_only";
  return final.validator_replaced ? "replaced_partial" : "answered";
}

export function makeTurnRow(args: {
  requestId: string; userId: string; request: MentorChatRequest; startedAt: Date;
  final: MentorFinalEvent | null; error?: MentorErrorCode; latencyMs: number;
  calls: number; chargedMicro: number; houseMicro: number; retries: number; coldCache: boolean;
}): MentorTurnRow {
  const f = args.final;
  return {
    request_id: args.requestId, user_id: args.userId, conversation_id: f?.conversation_id ?? args.request.conversation_id ?? null,
    created_at: args.startedAt.toISOString(), entry: args.request.entry ?? "nav", channel: args.request.channel ?? "web",
    lang: args.request.lang, mode: args.request.mode, question_id: args.request.question_id ?? null,
    outcome: turnOutcome(f, args.error), refusal_reason: f?.refused ?? null,
    replaced_count: f?.validator_replaced ? Math.max(1, f.replaced_count ?? 1) : 0,
    calls: args.calls, retries: args.retries, latency_ms: Math.max(0, args.latencyMs),
    charged: args.chargedMicro > 0, charged_micro: args.chargedMicro, house_micro: args.houseMicro,
    fact_ids: [...new Set(f?.answer_blocks.flatMap((b) => b.fact_ids) ?? [])],
    next_actions_shown: [...new Set(f?.next_actions?.map((action) => action.kind) ?? [])], next_action_clicked: null, hint_used: false, solution_shown: false, cold_cache: args.coldCache,
  };
}

export async function writeMentorTurn(db: SupabaseClient, row: MentorTurnRow): Promise<void> {
  const { error } = await db.from("ai_mentor_turn").upsert(row, { onConflict: "request_id", ignoreDuplicates: true });
  if (error) throw new Error("mentor outcome write failed");
}
