/**
 * The shared reward grant helper (a-rewards-program, plan.json J10). Every
 * experience reward goes through grantReward / clawbackReward, so the key
 * rules, the banned-account check and the monthly breakers live in one place.
 * Server only. Config and timing: src/lib/rewards-program.ts.
 *
 * Lot keys, one lot per key ever (UNIQUE(source, source_id) makes a retry a
 * duplicate, never a second grant):
 *
 *   testimonial   experience_reward / experience_reward  testimonial:<user>
 *   exam_report   admin_gift / gift_admin                reward:exam_report:<exam_key>:<date>:<user>
 *   fix           admin_gift / gift_admin                reward:fix:<suggestion id>
 *
 * The new kinds reuse the long-allowed admin_gift source with a reward:
 * prefix, so no migration touches the lot source check list. The included-
 * credit keys on admin_gift are <subscription>:<slice> or <user>:<slice>, so
 * the prefix never collides. A clawed-back reward key stays used: reverting a
 * fix and applying it again grants nothing new.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { viennaMonthStart } from "@/lib/vienna-month";
import type { CreditLotSource, MentorPackageId } from "../contract";
import { creditsFromMicro } from "../config";
import { rpcClawback, rpcGrantCredits, type GrantOutcome } from "./db";
import { creditsToMicro, experienceRewardSourceId } from "./free-credits";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export type RewardKind = "testimonial" | "exam_report" | "fix";

/** Prefix of every program reward on the admin_gift source. */
export const REWARD_SOURCE_ID_PREFIX = "reward:";

export interface RewardKey {
  source: CreditLotSource;
  packageId: MentorPackageId;
  sourceId: string;
}

export type RewardRef =
  | { kind: "testimonial"; userId: string }
  | { kind: "exam_report"; userId: string; sittingKey: string }
  | { kind: "fix"; userId: string; suggestionId: number | string };

export function rewardKey(ref: RewardRef): RewardKey {
  switch (ref.kind) {
    case "testimonial":
      return { source: "experience_reward", packageId: "experience_reward", sourceId: experienceRewardSourceId(ref.userId) };
    case "exam_report":
      return { source: "admin_gift", packageId: "gift_admin", sourceId: `${REWARD_SOURCE_ID_PREFIX}exam_report:${ref.sittingKey}:${ref.userId}` };
    case "fix":
      return { source: "admin_gift", packageId: "gift_admin", sourceId: `${REWARD_SOURCE_ID_PREFIX}fix:${String(ref.suggestionId)}` };
  }
}

/** The reward kind an admin_gift lot key names, or null (an included or manual gift). */
export function rewardKindOfLot(source: string, sourceId: string): Exclude<RewardKind, "testimonial"> | null {
  if (source !== "admin_gift" || !sourceId.startsWith(REWARD_SOURCE_ID_PREFIX)) return null;
  const rest = sourceId.slice(REWARD_SOURCE_ID_PREFIX.length);
  return rest.startsWith("exam_report:") ? "exam_report" : rest.startsWith("fix:") ? "fix" : null;
}

export type RewardGrantResult =
  | { ok: true; duplicate: boolean; lotId: string | null; credits: number; expiresAt: string }
  | { ok: false; reason: "banned" | "not_found" | "cap_reached" | "grant_failed"; detail?: GrantOutcome["reason"] };

export interface GrantRewardArgs {
  ref: RewardRef;
  credits: number;
  expiryDays: number;
  now: Date;
  /** Breaker: refuse when the check says the month is full (runs after the account check). */
  breaker?: () => Promise<boolean>;
}

/**
 * Grant one reward. The caller has already decided (an admin action); this
 * only enforces the account rules, the breaker and idempotency. A duplicate
 * (same key granted before) is ok:true, duplicate:true and adds nothing; the
 * breaker is skipped for a key that already has its lot.
 */
export async function grantReward(sb: Db, a: GrantRewardArgs): Promise<RewardGrantResult> {
  const user = await sb.from("users").select("is_banned").eq("id", a.ref.userId).maybeSingle();
  if (user.error) throw new Error(`reward user read failed: ${user.error.code ?? "unknown"}`);
  if (!user.data) return { ok: false, reason: "not_found" };
  if ((user.data as { is_banned?: boolean | null }).is_banned === true) return { ok: false, reason: "banned" };

  const key = rewardKey(a.ref);
  if (a.breaker) {
    const existing = await sb.from("ai_credit_lot").select("id").eq("source", key.source).eq("source_id", key.sourceId).limit(1);
    if (existing.error) throw new Error(`reward lot read failed: ${existing.error.code ?? "unknown"}`);
    if ((existing.data ?? []).length === 0 && (await a.breaker())) return { ok: false, reason: "cap_reached" };
  }

  const expiresAt = new Date(a.now.getTime() + a.expiryDays * 86_400_000);
  const g = await rpcGrantCredits(sb, {
    userId: a.ref.userId,
    packageId: key.packageId,
    source: key.source,
    sourceId: key.sourceId,
    micro: creditsToMicro(a.credits),
    startsAt: a.now,
    expiresAt,
  });
  if (!g.ok) return { ok: false, reason: "grant_failed", detail: g.reason };
  return { ok: true, duplicate: g.duplicate, lotId: g.lotId, credits: g.grantedMicro != null ? creditsFromMicro(g.grantedMicro) : a.credits, expiresAt: expiresAt.toISOString() };
}

export type RewardClawbackResult =
  | { ok: true; clawed: boolean; credits: number }
  | { ok: false; reason: "failed" };

/**
 * Take back the unspent part of a reward (a reverted fix, an undone
 * decision). No lot under the key = nothing to do (ok, clawed:false).
 * Idempotent: a second call changes nothing.
 */
export async function clawbackReward(sb: Db, ref: RewardRef, note: string): Promise<RewardClawbackResult> {
  const key = rewardKey(ref);
  const r = await rpcClawback(sb, key.source, key.sourceId, note);
  if (!r.ok) return r.reason === "not_found" ? { ok: true, clawed: false, credits: 0 } : { ok: false, reason: "failed" };
  return { ok: true, clawed: !r.duplicate, credits: r.duplicate ? 0 : creditsFromMicro(r.clawedMicro ?? 0) };
}

/** This Vienna month's exam report grants across all accounts. Throws on a read error. */
export async function readExamReportGrantsThisMonth(sb: Pick<SupabaseClient, "from">, now: Date): Promise<number> {
  const { count, error } = await sb.from("ai_credit_lot").select("id", { count: "exact", head: true })
    .eq("source", "admin_gift").like("source_id", `${REWARD_SOURCE_ID_PREFIX}exam_report:%`)
    .gte("created_at", viennaMonthStart(now).toISOString());
  if (error) throw new Error(`exam report breaker read failed: ${error.code ?? "unknown"}`);
  return count ?? 0;
}

/** Credits granted to one learner for fixes this Vienna month (clawed-back lots still count). Throws on a read error. */
export async function readFixCreditsThisMonth(sb: Pick<SupabaseClient, "from">, userId: string, now: Date): Promise<number> {
  const { data, error } = await sb.from("ai_credit_lot").select("granted_micro")
    .eq("user_id", userId).eq("source", "admin_gift").like("source_id", `${REWARD_SOURCE_ID_PREFIX}fix:%`)
    .gte("created_at", viennaMonthStart(now).toISOString()).limit(1000);
  if (error) throw new Error(`fix breaker read failed: ${error.code ?? "unknown"}`);
  let micro = 0;
  for (const r of (data ?? []) as Array<{ granted_micro: number | string }>) micro += Number(r.granted_micro) || 0;
  return creditsFromMicro(micro);
}
