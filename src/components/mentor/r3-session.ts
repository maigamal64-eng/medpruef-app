import type { ChatState } from "./chat-state";
import type { MentorThread } from "@/lib/mentor/thread";
import { toMentorEvent } from "./sse";
export function threadState(thread: MentorThread): ChatState {
  const messages: ChatState["messages"] = thread.messages.map(m => m.role === "user" ? { id: m.id, role: "user", text: m.text } : {
    id: m.id, role: "assistant", text: m.text, status: "done", ...(m.final ? { final: m.final } : {}),
  });
  const final = messages.filter(m => m.role === "assistant").at(-1)?.final;
  return { messages, conversationId: thread.conversation_id ?? undefined, busy: false, credits: final ? { left: final.credits_left, estimate: final.messages_left_estimate } : null };
}
/** Cache is a first paint only. Unfinished messages keep their original UUID for result recovery. */
export function parseChatCache(raw: string | null): ChatState | null {
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as ChatState;
    if (!Array.isArray(state.messages) || state.messages.length > 60) return null;
    for (const m of state.messages) {
      if (!m || typeof m.id !== "string" || typeof m.text !== "string" || !["user","assistant"].includes(m.role)) return null;
      if (m.role === "assistant" && m.final && toMentorEvent(m.final)?.type !== "final") return null;
    }
    return { ...state, busy: false, messages: state.messages.map(m => m.role === "assistant" && m.status === "streaming" ? { ...m, status: "error", text: "", error: "network" } : m.role === "assistant" && ["error","stopped"].includes(m.status) ? {...m,text:""} : m) };
  } catch { return null; }
}
export function countdownAnnouncement(previous: number, current: number): boolean {
  return [30,10,0].some(n => previous > n && current <= n);
}
