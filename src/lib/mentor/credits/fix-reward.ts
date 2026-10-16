/**
 * Applied-fix reward (a-rewards-program, plan.json J10): REWARDS_FIX_ENABLED,
 * default OFF. When an admin resolves a question report as fixed (an applied
 * edit, or Confirm with the outcome "fixed"), the reporter receives 10 AI
 * Mentor credits, at most 100 per learner per Vienna month. The admin's
 * decision is the approval; a report alone never grants anything. Reverting
 * the edit or undoing the decision claws back the unspent part. One reward
 * per report ever (key reward:fix:<suggestion id>).
 *
 * Both calls are best effort from the resolve route: a failure is reported
 * and never changes the resolution itself.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RewardConfig } from "@/lib/rewards-program";
import { clawbackReward, grantReward, readFixCreditsThisMonth } from "./rewards";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export type FixRewardOutcome =
  | { status: "granted"; credits: number; expiresAt: string; lotId: string | null }
  | { status: "skipped"; reason: "anonymous" | "banned" | "cap_reached" | "already_rewarded" }
  | { status: "failed" };

export async function rewardAppliedFix(
  sb: Db,
  a: { suggestionId: number | string; userId: string | null; now: Date },
  rc: Pick<RewardConfig, "fixCredits" | "fixExpiryDays" | "fixMonthlyCreditCap">,
): Promise<FixRewardOutcome> {
  if (!a.userId) return { status: "skipped", reason: "anonymous" };
  const userId = a.userId;
  try {
    const g = await grantReward(sb, {
      ref: { kind: "fix", userId, suggestionId: a.suggestionId },
      credits: rc.fixCredits,
      expiryDays: rc.fixExpiryDays,
      now: a.now,
      breaker: async () => (await readFixCreditsThisMonth(sb, userId, a.now)) + rc.fixCredits > rc.fixMonthlyCreditCap,
    });
    if (!g.ok) {
      if (g.reason === "banned" || g.reason === "not_found") return { status: "skipped", reason: "banned" };
      if (g.reason === "cap_reached") return { status: "skipped", reason: "cap_reached" };
      return { status: "failed" };
    }
    if (g.duplicate) return { status: "skipped", reason: "already_rewarded" };
    return { status: "granted", credits: g.credits, expiresAt: g.expiresAt, lotId: g.lotId };
  } catch {
    return { status: "failed" };
  }
}

export type FixClawbackOutcome = { status: "clawed_back"; credits: number } | { status: "none" } | { status: "failed" };

/** Take back a fix reward (edit reverted or decision undone). No reward = none. */
export async function clawbackAppliedFix(sb: Db, a: { suggestionId: number | string; userId: string | null }, note: string): Promise<FixClawbackOutcome> {
  if (!a.userId) return { status: "none" };
  try {
    const r = await clawbackReward(sb, { kind: "fix", userId: a.userId, suggestionId: a.suggestionId }, note);
    if (!r.ok) return { status: "failed" };
    return r.clawed ? { status: "clawed_back", credits: r.credits } : { status: "none" };
  } catch {
    return { status: "failed" };
  }
}
