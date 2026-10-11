import type { MentorChatRequest } from "@/lib/mentor/contract";
import { lastUserRequest, type ChatState } from "./chat-state";

/** Explicit retry of a known, finished free notice is a new attempt. Any
 * network/stream recovery must retain the original UUID instead. */
export function terminalNoticeRetry(state: ChatState, newUuid: string): MentorChatRequest | null {
  const last = state.messages.at(-1);
  const original = lastUserRequest(state);
  if (state.busy || !original || last?.role !== "assistant" || last.status !== "done") return null;
  const final = last.final;
  if (final?.result !== "notice" || final.charged !== false || !["empty", "truncated"].includes(final.reason ?? "")) return null;
  return { ...original, conversation_id: final.conversation_id, client_request_id: newUuid };
}
