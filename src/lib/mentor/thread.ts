import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorFinalEvent } from "./contract";
import { MENTOR_HISTORY_TURNS } from "./config";

export interface MentorThread {
  conversation_id: string | null;
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; final?: MentorFinalEvent }>;
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
/** One owner-scoped store, shared by reload, resume and purchase return. No model or ledger calls. */
export async function loadMentorThread(db: SupabaseClient, userId: string, conversationId?: string): Promise<MentorThread> {
  if (conversationId && !UUID.test(conversationId)) throw new Error("invalid conversation");
  let id = conversationId;
  if (!id) {
    const latest = await db.from("ai_mentor_message").select("conversation_id").eq("user_id", userId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
    if (latest.error) throw new Error("mentor history read failed");
    id = latest.data?.conversation_id;
  }
  if (!id) return { conversation_id: null, messages: [] };
  const rows = await db.from("ai_mentor_message").select("id,role,text,request_id").eq("user_id", userId).eq("conversation_id", id)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MENTOR_HISTORY_TURNS);
  if (rows.error) throw new Error("mentor history read failed");
  if (!rows.data?.length) return { conversation_id: null, messages: [] };
  const ids = [...new Set(rows.data.map(r => r.request_id))];
  const results = await db.from("ai_mentor_request").select("request_id,final_event").eq("user_id", userId).eq("status", "complete")
    .gt("expires_at", new Date().toISOString()).in("request_id", ids);
  if (results.error) throw new Error("mentor results read failed");
  const finals = new Map((results.data ?? []).map(r => [r.request_id, r.final_event as MentorFinalEvent]));
  const messages: MentorThread["messages"] = [...rows.data].reverse().filter(r => r.role === "user" || r.role === "assistant").map(r => ({
    id: String(r.id), role: r.role, text: r.text,
    ...(r.role === "assistant" && finals.has(r.request_id) ? { final: finals.get(r.request_id) } : {}),
  }));
  while (messages[0]?.role === "assistant") messages.shift();
  return { conversation_id: id, messages };
}
