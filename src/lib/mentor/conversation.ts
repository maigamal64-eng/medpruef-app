/**
 * Mentor conversation history (W2-CORE) over public.ai_mentor_message.
 *
 * Stored text only (no thinking blocks, no tool payloads), so a rebuilt
 * history can never replay a thinking block. Every read is scoped by user_id:
 * a conversation id the caller does not own behaves like a new conversation
 * and gets a fresh server id. The route reads before the turn and writes the
 * user + assistant pair after the `final` event (turn.ts stays I/O free).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MessageParam } from "@/lib/ai/anthropic";
import { MENTOR_HISTORY_TURNS } from "./config";
import type { MentorLang, MentorMode, MentorRefusalReason } from "./contract";

export const MENTOR_MESSAGE_TABLE = "ai_mentor_message";
/** The SQL CHECK allows 1..20000 characters per stored message. */
export const MENTOR_STORED_TEXT_MAX = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredMessageRow {
  role: "user" | "assistant";
  text: string;
}

/**
 * Rows (oldest first) -> alternating history that starts with a user turn
 * and ends with an assistant turn. A user row without an answer (a failed
 * turn) is dropped; a leading assistant row is dropped.
 */
export function rowsToHistory(rows: StoredMessageRow[], maxMessages: number = MENTOR_HISTORY_TURNS): MessageParam[] {
  const clean = rows.filter((r) => (r.role === "user" || r.role === "assistant") && typeof r.text === "string" && r.text.trim() !== "");
  const out: MessageParam[] = [];
  for (const r of clean) {
    const prev = out[out.length - 1];
    if (r.role === "user") {
      // Two user rows in a row: the earlier one never got an answer.
      if (prev && prev.role === "user") out.pop();
      out.push({ role: "user", content: r.text });
    } else {
      if (!prev || prev.role !== "user") continue; // assistant without a question
      out.push({ role: "assistant", content: r.text });
    }
  }
  if (out.length && out[out.length - 1].role === "user") out.pop();
  // Keep the newest window, still starting on a user turn.
  let windowed = out.slice(Math.max(0, out.length - Math.max(0, maxMessages)));
  if (windowed.length && windowed[0].role !== "user") windowed = windowed.slice(1);
  return windowed;
}

export interface AppendTurn {
  conversationId: string;
  userId: string;
  requestId: string;
  lang: MentorLang;
  mode: MentorMode;
  userText: string;
  assistantText: string;
  factIds: string[];
  refused?: MentorRefusalReason;
}

export interface ConversationStore {
  /** Returns the caller's conversation (or a fresh id) and its rebuilt history. Throws on DB error. */
  resolve(userId: string, conversationId: string | undefined): Promise<{ conversationId: string; history: MessageParam[]; isNew: boolean }>;
  /** Writes the user and assistant rows. Never throws; false on failure. */
  append(turn: AppendTurn): Promise<boolean>;
}

function clip(text: string): string {
  return text.length > MENTOR_STORED_TEXT_MAX ? text.slice(0, MENTOR_STORED_TEXT_MAX) : text;
}

export function createConversationStore(client: SupabaseClient, newId: () => string = () => crypto.randomUUID()): ConversationStore {
  return {
    async resolve(userId, conversationId) {
      if (!conversationId || !UUID_RE.test(conversationId)) return { conversationId: newId(), history: [], isNew: true };
      // Read a little more than the window so a dropped orphan does not shrink it.
      const { data, error } = await client
        .from(MENTOR_MESSAGE_TABLE)
        .select("role,text,created_at,id")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MENTOR_HISTORY_TURNS * 2 + 2);
      if (error) throw new Error("ai_mentor_message read failed");
      const rows = Array.isArray(data) ? (data as StoredMessageRow[]) : [];
      if (rows.length === 0) return { conversationId: newId(), history: [], isNew: true };
      return { conversationId, history: rowsToHistory([...rows].reverse()), isNew: false };
    },

    async append(turn) {
      const user = turn.userText.trim();
      const assistant = turn.assistantText.trim();
      if (!user || !assistant) return false;
      const base = {
        conversation_id: turn.conversationId,
        user_id: turn.userId,
        request_id: turn.requestId,
        lang: turn.lang,
        mode: turn.mode,
      };
      try {
        const { error } = await client.from(MENTOR_MESSAGE_TABLE).insert([
          { ...base, role: "user", text: clip(user), fact_ids: [] },
          { ...base, role: "assistant", text: clip(assistant), fact_ids: turn.factIds, refused: turn.refused ?? null },
        ]);
        return !error;
      } catch {
        return false;
      }
    },
  };
}
