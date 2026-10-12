/**
 * Pure chat state machine for the mentor screen (W2-UI). A reducer plus small
 * helpers; no React, no I/O, so the whole turn lifecycle is unit tested.
 *
 * Lifecycle of one turn:
 *   send  -> user bubble + empty streaming assistant bubble, busy
 *   event(delta)  -> text appended
 *   event(final)  -> blocks, citations, refusal, credits; done; conversation kept
 *   event(error)  -> text discarded, assistant bubble in error state
 *   fail          -> request failed before a final (HTTP error / offline)
 *   end           -> stream closed; a still-open bubble without a final is an
 *                    interrupted answer, never a silent success
 *   stop          -> user pressed Hide (MUX-37 A): the answer is hidden but the
 *                    turn keeps running, the composer stays locked; the final
 *                    lands collapsed with its charged state, an error as usual
 *   retry         -> drop the failed assistant bubble and stream a new one
 */

import type { MentorChatRequest, MentorFinalEvent, MentorLang, MentorMode, MentorSseEvent } from "@/lib/mentor/contract";
import { MENTOR_MESSAGE_MAX_CHARS } from "@/lib/mentor/contract";
import type { MentorClientError } from "./api";

export interface UserMsg {
  id: string;
  role: "user";
  text: string;
  /** The immutable send body, including its UUID, is reused by retries. */
  request?: MentorChatRequest;
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
  inProgress?: boolean;
  phase?: "checking_sources" | "writing";
  slow?: boolean;
  startedAt?: number;
  limit?: "minute" | "day";
  reason?: string;
  errorAt?: string;
  requestId?: string;
  /** Server-confirmed: this failed turn deducted nothing. Never set for a network failure. */
  notCharged?: boolean;
  /** MUX-37 A: the learner pressed Hide; the answer arrives collapsed. */
  hidden?: boolean;
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
  | { type: "send"; userId: string; assistantId: string; text: string; request?: MentorChatRequest }
  | { type: "event"; event: MentorSseEvent }
  | { type: "fail"; error: MentorClientError; retryAfterSeconds?: number; packagesUrl?: string; limit?: "minute" | "day"; reason?: string; notCharged?: boolean }
  | { type: "restore"; state: ChatState }
  | { type: "slow" }
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
          { id: action.userId, role: "user", text: action.text, ...(action.request ? { request: action.request } : {}) },
          { id: action.assistantId, role: "assistant", status: "streaming", text: "", startedAt: Date.now(), requestId: action.request?.client_request_id },
        ],
      };
    }

    case "event": {
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return state;
      const e = action.event;
      if (e.type === "heartbeat") return state;
      if (e.type === "status") return withLastAssistant(state, m => ({ ...m, phase: e.phase }));
      if (e.type === "in_progress") return withLastAssistant(state, (m) => ({ ...m, inProgress: true }));
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
      // Never display undelivered text after an error. Only final blocks are checked.
      return { ...withLastAssistant(state, (m) => ({ ...m, status: "error", text: "", error: e.error, errorAt: new Date().toISOString(), ...(e.credits_deducted === false ? { notCharged: true } : {}) })), busy: false };
    }

    case "fail": {
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return { ...state, busy: false };
      const next = withLastAssistant(state, (m) => {
        const out: AssistantMsg = { ...m, status: "error", text: "", error: action.error, errorAt: new Date().toISOString(), limit: action.limit, reason: action.reason };
        if (action.retryAfterSeconds !== undefined) out.retryAfterSeconds = action.retryAfterSeconds;
        if (action.packagesUrl) out.packagesUrl = action.packagesUrl;
        if (action.notCharged && action.error !== "network") out.notCharged = true;
        return out;
      });
      return { ...next, busy: false };
    }

    case "end": {
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return { ...state, busy: false };
      // The stream closed with no final and no error event: interrupted.
      return { ...withLastAssistant(state, (m) => ({ ...m, status: "error", text: "", error: "upstream_error" })), busy: false };
    }

    case "stop": {
      // MUX-37 A: never free the composer while a turn is in flight. The turn
      // still finishes on the server and is billed by the normal rule, so the
      // answer is kept and only hidden until the final (or an error) arrives.
      const a = lastAssistant(state);
      if (!a || a.status !== "streaming") return state;
      return withLastAssistant(state, (m) => ({ ...m, hidden: true }));
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

    case "restore":
      return state.busy ? state : action.state;
    case "slow":
      return withLastAssistant(state, m => ({ ...m, slow: true }));
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

export function lastUserRequest(state: ChatState): MentorChatRequest | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === "user") return m.request;
  }
  return undefined;
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
  clientRequestId: string;
  entry?: MentorChatRequest["entry"];
  filingUniversity?: "wien" | "graz" | "innsbruck";
  selectedOptionText?: string;
  wasCorrect?: boolean;
  answered?: boolean;
  explainAction?: "hint" | "solution";
  hintCount?: 0 | 1 | 2;
}

/** The exact POST body for /api/mentor/chat. question_id only in explain mode. */
export function buildChatRequest(i: BuildRequestInput): MentorChatRequest {
  const req: MentorChatRequest = { message: i.text.trim(), lang: i.lang, mode: i.mode, client_request_id: i.clientRequestId };
  if (i.entry) req.entry = i.entry;
  if (i.conversationId) req.conversation_id = i.conversationId;
  if (i.mode === "explain" && i.questionId !== undefined) {
    req.question_id = i.questionId;
    if (i.selectedOptionText !== undefined) req.selected_option_text = i.selectedOptionText;
    if (i.wasCorrect !== undefined) req.was_correct = i.wasCorrect;
    if (i.answered !== undefined) req.answered = i.answered;
    if (i.explainAction) req.explain_action = i.explainAction;
    if (i.hintCount !== undefined) req.hint_count = i.hintCount;
  }
  if (i.filingUniversity) req.filing_university = i.filingUniversity;
  return req;
}

/** Parse ?question_id= from a search string. Positive integers only. */
export function parseQuestionId(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("question_id");
  if (!raw || !/^\d{1,12}$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
