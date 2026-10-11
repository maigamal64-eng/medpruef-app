import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorChatRequest, MentorChatResultResponse, MentorErrorCode, MentorFinalEvent } from "./contract";

export const MENTOR_RESULT_TTL_MS = 24 * 3600_000;
export const MENTOR_REQUEST_STALE_MS = 15 * 60_000;
export interface MentorRequestStore {
  claim(userId: string, request: MentorChatRequest, requestId: string): Promise<{ claimed: true; requestId: string } | { claimed: false; result: MentorChatResultResponse }>;
  finish(userId: string, requestId: string, result: MentorFinalEvent | MentorErrorCode): Promise<void>;
  result(userId: string, clientRequestId: string): Promise<MentorChatResultResponse>;
}

export function createMentorRequestStore(db: SupabaseClient): MentorRequestStore {
  return {
    async claim(userId, request, requestId) {
      // Bind retries to their original payload. A UUID cannot be reused for a different message.
      const fingerprint = createHash("sha256").update(JSON.stringify([request.message, request.lang, request.mode, request.question_id ?? null, request.conversation_id ?? null, request.selected_option_text ?? null, request.was_correct ?? null, request.filing_university ?? null, request.answered ?? null, request.explain_action ?? null, request.hint_count ?? null, request.entry ?? "nav", request.channel ?? "web"])).digest("hex");
      const { data, error } = await db.rpc("mentor_claim_request", {
        p_user: userId, p_client: request.client_request_id, p_request: requestId, p_fingerprint: fingerprint,
        p_meta: { entry: request.entry ?? "nav", channel: request.channel ?? "web", lang: request.lang, mode: request.mode, question_id: request.question_id ?? null, conversation_id: request.conversation_id ?? null },
      });
      if (error || !data?.ok) throw new Error("mentor request claim failed");
      if (data.claimed === true && typeof data.request_id === "string") return { claimed: true, requestId: data.request_id };
      return { claimed: false, result: data.result as MentorChatResultResponse };
    },
    async finish(userId, requestId, result) {
      const { error } = await db.from("ai_mentor_request").update({
        status: typeof result === "string" ? "error" : "complete",
        final_event: typeof result === "string" ? null : result,
        error_code: typeof result === "string" ? result : null,
        completed_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("request_id", requestId).eq("status", "running");
      if (error) throw new Error("mentor result persist failed");
    },
    async result(userId, clientRequestId) {
      const { data, error } = await db.from("ai_mentor_request").select("status,final_event,error_code,created_at,expires_at")
        .eq("user_id", userId).eq("client_request_id", clientRequestId).maybeSingle();
      if (error) throw new Error("mentor result read failed");
      if (!data) return { status: "missing" };
      const now = Date.now();
      if (Date.parse(data.expires_at) <= now) return { status: "expired" };
      if (data.status === "complete") return { status: "complete", final: data.final_event };
      if (data.status === "error") return { status: "error", error: data.error_code ?? "upstream_error" };
      if (now - Date.parse(data.created_at) >= MENTOR_REQUEST_STALE_MS) return { status: "error", error: "upstream_error" };
      return { status: "in_progress" };
    },
  };
}
