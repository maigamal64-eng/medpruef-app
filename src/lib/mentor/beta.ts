import type { SupabaseClient } from "@supabase/supabase-js";
/** DB override controls beta membership only. Masters, rollout and metering remain mandatory. */
export async function mentorBetaAllowed(db: SupabaseClient, userId: string, legacyIds: readonly string[], options: { throwOnError?: boolean } = {}): Promise<boolean> {
 const { data,error } = await db.from("ai_mentor_beta_override").select("allowed").eq("user_id",userId).maybeSingle();
 if(error) { if(options.throwOnError) throw new Error("mentor beta availability read failed"); return false; }
 return data ? data.allowed===true : legacyIds.length===0||legacyIds.includes(userId.toLowerCase());
}
