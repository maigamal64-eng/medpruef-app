import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Beta membership is an explicit allowlist (free beta, [name] 12 Oct 2026).
 * A DB override row decides; without a row only the MENTOR_BETA_USER_IDS env
 * list admits. An empty list admits nobody: there is no "everyone" fallback.
 * Masters, rollout and metering remain mandatory.
 */
export function envAllowlisted(ids: readonly string[], userId: string): boolean {
  return ids.includes(userId.toLowerCase());
}

export async function mentorBetaAllowed(db: SupabaseClient, userId: string, legacyIds: readonly string[], options: { throwOnError?: boolean } = {}): Promise<boolean> {
 const { data,error } = await db.from("ai_mentor_beta_override").select("allowed").eq("user_id",userId).maybeSingle();
 if(error) { if(options.throwOnError) throw new Error("mentor beta availability read failed"); return false; }
 return data ? data.allowed===true : envAllowlisted(legacyIds, userId);
}
