/**
 * Pure chat state machine for the mentor screen (W2-UI). A reducer plus small
 * helpers; no React, no I/O, so the whole turn lifecycle is unit tested.
 *
 * Lifecycle of one turn:
 *   send  -> user bubble + empty streaming assistant bubble, busy
 *   event(delta)  -> text appended
 *   event(final)  -> blocks, citations, refusal, credits; done; conversation kept
 *   event(error)  -> partial text kept, assistant bubble in error state
 *   fail          -> request failed before a final (HTTP error / offline)
 *   end           -> stream closed; a still-open bubble without a final is an
 *                    interrupted answer, never a silent success
 *   stop          -> user pressed stop; partial text kept
 *   retry         -> drop the failed assistant bubble and stream a new one
 */

import type { MentorChatRequest, MentorFinalEvent, MentorLang, MentorMode, MentorSseEvent } from "@/lib/mentor/contract";
import { MENTOR_MESSAGE_MAX_CHARS } from "@/lib/mentor/contract";
import type { MentorClientError } from "./api";

export interface UserMsg {
  id: string;
  role: "user";
  text: string;
}

export type AssistantStatus = "streaming" | "done" | "error" | "stopped";

export interface AssistantMsg {
  id: string;
  role: "assistant";
  status: AssistantStatus;
  /** Raw streamed text. Replaced on screen by `final.answer_blocks` once present. */
  text: string;
  final?: MentorFinalEvent;
  error?: MentorClientError;
  retryAfterSeconds?: number;
  packagesUrl?: string;
}

export type ChatMsg = UserMsg | AssistantMsg;

export interface ChatState {
  messages: ChatMsg[];
  conversationId?: string;
  busy: boolean;
  /** Last balance the server reported in a final event. */
  credits: { left: number; estimate: number } | null;
}

export const INITIAL_CHAT_STATE: ChatState = { messages: [], busy: false, credits: null };

export type ChatAction =
  | { type: "send"; userId: string; assistantId: string; text: string }
  | { type: "event"; event: MentorSseEvent }
  | { type: "fail"; error: MentorClientError; retryAfterSeconds?: number; packagesUrl?: string }
  | { type: "end" }
  | { type: "stop" }
  | { type: "retry"; assistantId: string }
  | { type: "reset" };

function lastAssistant(state: ChatState): AssistantMsg | null {
  const last = state.messages[state.messages.length - 1];
  return last && last.role === "assistant" ? last : null;
}

function withLastAssistant(state: ChatState, patch: (a: AssistantMsg) => AssistantMsg): ChatState {
  const last = lastAssistant(state);
  if (!last) return state;
  return { ...state, messages: [...state.messages.slice(0, -1), patch(last)] };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      if (state.busy) return state;
      return {
        ...state,
        busy: true,
        messages: [
          ...state.messages,
          { id: action.userId, role: "user", text: action.text },
          { id: action.assistantId, role: "assistant", status: "streaming", text: "" },
        ],
      };
    }

    case "event": {
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return state;
      const e = action.event;
      if (e.type === "delta") return withLastAssistant(state, (m) => ({ ...m, text: m.text + e.text }));
      if (e.type === "final") {
        const next = withLastAssistant(state, (m) => ({ ...m, status: "done", final: e, error: undefined }));
        return {
          ...next,
          busy: false,
          conversationId: e.conversation_id,
          credits: { left: e.credits_left, estimate: e.messages_left_estimate },
        };
      }
      // error event: keep whatever text arrived
      return { ...withLastAssistant(state, (m) => ({ ...m, status: "error", error: e.error })), busy: false };
    }

    case "fail": {
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return { ...state, busy: false };
      const next = withLastAssistant(state, (m) => {
        const out: AssistantMsg = { ...m, status: "error", error: action.error };
        if (action.retryAfterSeconds !== undefined) out.retryAfterSeconds = action.retryAfterSeconds;
        if (action.packagesUrl) out.packagesUrl = action.packagesUrl;
        return out;
      });
      return { ...next, busy: false };
    }

    case "end": {
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return { ...state, busy: false };
      // The stream closed with no final and no error event: interrupted.
      return { ...withLastAssistant(state, (m) => ({ ...m, status: "error", error: "upstream_error" })), busy: false };
    }

    case "stop": {
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return { ...state, busy: false };
      return { ...withLastAssistant(state, (m) => ({ ...m, status: "stopped" })), busy: false };
    }

    case "retry": {
      if (state.busy) return state;
      const a = lastAssistant(state);
      if (!a || (a.status !== "error" && a.status !== "stopped")) return state;
      return {
        ...state,
        busy: true,
        messages: [...state.messages.slice(0, -1), { id: action.assistantId, role: "assistant", status: "streaming", text: "" }],
      };
    }

    case "reset":
      return { ...INITIAL_CHAT_STATE, credits: state.credits };
  }
}

/** Text of the most recent user message, for retry. */
export function lastUserText(state: ChatState): string | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === "user") return m.text;
  }
  return null;
}

export interface DraftStatus {
  count: number;
  max: number;
  over: boolean;
  /** Show the counter once the learner is close to the limit. */
  nearLimit: boolean;
  empty: boolean;
}

export function draftStatus(draft: string, max: number = MENTOR_MESSAGE_MAX_CHARS): DraftStatus {
  const trimmed = draft.trim();
  const count = [...trimmed].length;
  return { count, max, over: count > max, nearLimit: count >= Math.floor(max * 0.8), empty: count === 0 };
}

export function canSubmit(draft: string, busy: boolean): boolean {
  const s = draftStatus(draft);
  return !busy && !s.empty && !s.over;
}

export interface BuildRequestInput {
  text: string;
  conversationId?: string;
  lang: MentorLang;
  mode: MentorMode;
  questionId?: number;
}

/** The exact POST body for /api/mentor/chat. question_id only in explain mode. */
export function buildChatRequest(i: BuildRequestInput): MentorChatRequest {
  const req: MentorChatRequest = { message: i.text.trim(), lang: i.lang, mode: i.mode };
  if (i.conversationId) req.conversation_id = i.conversationId;
  if (i.mode === "explain" && i.questionId !== undefined) req.question_id = i.questionId;
  return req;
}

/** Parse ?question_id= from a search string. Positive integers only. */
export function parseQuestionId(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("question_id");
  if (!raw || !/^\d{1,12}$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
