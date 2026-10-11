import type { SupabaseClient } from "@supabase/supabase-js";

export interface MentorLearnerPanel {
  generated_at: string;
  lots: Array<{ id: string; package_id: string; status: string; granted_micro: number; spent_micro: number; clawed_back_micro: number; remaining_micro: number; starts_at: string; expires_at: string }>;
  holds: Array<{ request_id: string; call_index: number; ceiling_micro: number; created_at: string }>;
  turns: Array<{ request_id: string; created_at: string; outcome: string; lang: string; calls: number; charged_micro: number; house_micro: number }>;
  memberships: Array<{ membership_id: string; package_id: string; status: string; renews_at: string | null; ends_at: string | null }>;
  refunds: Array<{ id: number; kind: string; package_id: string | null; delta_micro_usd: number; created_at: string }>;
  truncated: string[];
}
/** Bounded read-only support view. Outcome reads intentionally omit answer/fact text. */
export async function loadMentorLearnerPanel(db: SupabaseClient, userId: string, now: Date): Promise<MentorLearnerPanel> {
  const reads = await Promise.all([
    db.from("ai_credit_lot").select("id,package_id,status,granted_micro,spent_micro,clawed_back_micro,starts_at,expires_at").eq("user_id", userId).order("created_at", {ascending:false}).limit(201),
    db.from("ai_mentor_reservation").select("request_id,call_index,ceiling_micro,created_at").eq("user_id", userId).eq("status", "open").order("created_at", {ascending:false}).limit(201),
    db.from("ai_mentor_turn").select("request_id,created_at,outcome,lang,calls,charged_micro,house_micro").eq("user_id", userId).order("created_at", {ascending:false}).order("request_id", {ascending:false}).limit(20),
    db.from("ai_mentor_whop_membership").select("membership_id,package_id,status,renews_at,ends_at").eq("user_id", userId).order("created_at", {ascending:false}).limit(201),
    db.from("ai_usage_ledger").select("id,kind,package_id,delta_micro_usd,created_at").eq("user_id", userId).in("kind", ["clawback", "clawback_debt"]).order("id", {ascending:false}).limit(201),
  ]);
  if (reads.some(row => row.error)) throw new Error("mentor_learner_unavailable");
  const lots = reads[0].data ?? [];
  const holds = reads[1].data ?? [];
  const turns = reads[2].data ?? [];
  const memberships = reads[3].data ?? [];
  const refunds = reads[4].data ?? [];
  const names = ["lots", "holds", "turns", "memberships", "refunds"];
  return {
    generated_at: now.toISOString(),
    lots: lots.slice(0,200).map(lot=> ({...lot, remaining_micro: lot.status === "live" && Date.parse(lot.starts_at) <= now.getTime() && now.getTime() < Date.parse(lot.expires_at) ? Math.max(0, Number(lot.granted_micro)-Number(lot.spent_micro)-Number(lot.clawed_back_micro)):0})) as MentorLearnerPanel["lots"],
    holds: holds.slice(0,200) as MentorLearnerPanel["holds"], turns: turns as MentorLearnerPanel["turns"],
    memberships: memberships.slice(0,200) as MentorLearnerPanel["memberships"], refunds: refunds.slice(0,200) as MentorLearnerPanel["refunds"],
    truncated: reads.flatMap((row,i)=> (row.data?.length ?? 0)>200 ? [names[i]]:[]),
  };
}
