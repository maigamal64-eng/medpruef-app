import type { SupabaseClient } from "@supabase/supabase-js";
import { MENTOR_REPORT_REASONS } from "@/lib/mentor/contract";

export async function saveMentorReport(db: SupabaseClient, userId: string, body: unknown, now = Date.now()): Promise<boolean> {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (typeof b.request_id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(b.request_id)) return false;
  if (typeof b.reason !== "string" || !(MENTOR_REPORT_REASONS as readonly string[]).includes(b.reason)) return false;
  if (b.details !== undefined && (typeof b.details !== "string" || b.details.length > 1500)) return false;
  const { data, error } = await db.from("ai_mentor_message").select("text,fact_ids,lang")
    .eq("user_id", userId).eq("request_id", b.request_id).eq("role", "assistant")
    .gte("created_at", new Date(now - 30 * 86400_000).toISOString()).maybeSingle();
  if (error) throw new Error("mentor report answer read failed");
  if (!data || typeof data.text !== "string" || !data.text) return false;
  const write = await db.from("ai_mentor_report").upsert({
    user_id: userId, request_id: b.request_id, fact_ids: data.fact_ids ?? [],
    answer_text: data.text, lang: data.lang ?? "en", reason: b.reason, details: b.details ?? null,
  }, { onConflict: "user_id,request_id", ignoreDuplicates: true });
  if (write.error) throw new Error("mentor report save failed");
  return true;
}
