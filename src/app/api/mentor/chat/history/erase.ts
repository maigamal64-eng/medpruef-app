import type { SupabaseClient } from "@supabase/supabase-js";
export async function eraseMentorHistory(db: Pick<SupabaseClient, "rpc">, userId: string) {
  const { data, error } = await db.rpc("mentor_erase_history", { p_user: userId });
  if (error || !data || typeof data.ok !== "boolean") throw new Error("mentor erasure failed");
  return data.ok ? { ok: true as const } : { ok: false as const, reason: data.reason === "in_progress" ? "in_progress" : "invalid_input" };
}
