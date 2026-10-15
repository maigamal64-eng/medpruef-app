/**
 * Mentor credits: the real Wallet (seam.ts C17) over the C3 ledger.
 * W2-CORE's chat/usage routes call createWallet(getServiceClient()).
 *
 *   ensureIncludedGrants  reads users / subscriptions / referrals and the
 *                         package catalogue, plans with included.ts and calls
 *                         mentor_grant_credits (idempotent on the lot key).
 *                         Throws on any DB error (caller: 503 reserve_failed).
 *                         The welcome lot (MENTOR_WELCOME_ENABLED) is decided
 *                         here: only on the free branch, only when no welcome
 *                         lot exists, the account is eligible and the monthly
 *                         breaker has room. A failed welcome grant is reported
 *                         and skipped, never a 503 (it is a bonus).
 *   balance               mentor_balance -> WalletBalance (throws on error).
 *   avgMessageCostMicro   rolling average user-billed cost of the last 20
 *                         messages from ai_usage_ledger settle rows, or null.
 *   accessSources         which lot kinds fund the user now (copy only).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { readMentorConfig } from "../config";
import type { MentorAccessSource, MentorPackageId, MentorPackageKind } from "../contract";
import type { Wallet, WalletBalance, WalletLot } from "../seam";
import { isUuid, rpcBalance, rpcGrantCredits, type BalanceRow } from "./db";
import { includedAmountOverrides, readFreeCreditConfig, creditsToMicro, type FreeCreditConfig } from "./free-credits";
import { viennaMonthStart } from "@/lib/vienna-month";
import {
  planIncludedGrantsDetailed,
  isVerifiedAccount,
  type EntitlementSnapshot,
  type EntitlementReferral,
  type EntitlementSub,
  type EntitlementUser,
  type IncludedPackageRow,
} from "./included";
import { loadPackageCatalogue } from "./packages";

type Db = Pick<SupabaseClient, "from" | "rpc">;

const AVG_WINDOW_MESSAGES = 20;

export function toWalletBalance(b: BalanceRow): WalletBalance {
  const lots: WalletLot[] = b.lots.map((l) => ({
    lotId: l.lot_id,
    packageId: l.package_id,
    kind: l.kind as MentorPackageKind,
    source: l.source,
    remainingMicro: l.remaining_micro,
    grantedMicro: l.granted_micro,
    startsAt: l.starts_at,
    expiresAt: l.expires_at,
  }));
  return {
    availableMicro: b.available_micro,
    lotsMicro: b.lots_micro,
    reservedMicro: b.reserved_micro,
    debtMicro: b.debt_micro,
    nextExpiry: b.next_expiry,
    everGranted: b.ever_granted,
    lots,
  };
}

/** Lot kinds with credit left now -> learner-facing source labels. */
export function accessSourcesFromLots(lots: WalletLot[], nowMs: number = Date.now()): MentorAccessSource[] {
  const kinds = new Set(
    lots
      .filter((l) => l.remainingMicro > 0 && Date.parse(l.startsAt) <= nowMs && Date.parse(l.expiresAt) > nowMs)
      .map((l) => l.kind),
  );
  const out: MentorAccessSource[] = [];
  if (kinds.has("subscription") || kinds.has("topup")) out.push("package");
  if (kinds.has("included") || kinds.has("unknown")) out.push("pro_included");
  if (kinds.has("trial")) out.push("trial");
  if (kinds.has("gift") || kinds.has("referral")) out.push("gift");
  if (kinds.has("admin")) out.push("admin");
  return out.length > 0 ? out : ["none"];
}

/**
 * Average user-billed micro-USD per message over the newest settle rows,
 * grouped by request id (one request = one user message, up to 3 calls).
 */
export function averageMessageCost(
  rows: Array<{ request_id: string | null; delta_micro_usd: number | string | null }>,
  window: number = AVG_WINDOW_MESSAGES,
): number | null {
  const perRequest = new Map<string, number>();
  for (const r of rows) {
    if (!r.request_id) continue;
    const delta = Number(r.delta_micro_usd);
    if (!Number.isFinite(delta)) continue;
    if (!perRequest.has(r.request_id)) {
      if (perRequest.size >= window) break;
      perRequest.set(r.request_id, 0);
    }
    perRequest.set(r.request_id, (perRequest.get(r.request_id) as number) + Math.max(0, -delta));
  }
  const costs = [...perRequest.values()].filter((c) => c > 0);
  if (costs.length === 0) return null;
  return Math.ceil(costs.reduce((a, b) => a + b, 0) / costs.length);
}

export interface WalletOptions {
  /** MENTOR_FREE_ENABLED; defaults to the env config. */
  freeEnabled?: boolean;
  /** Free credit hooks (amount overrides, welcome lot); defaults to the env config. */
  freeCredits?: FreeCreditConfig;
}

/** Welcome eligibility (L3): not banned AND (verified OR enough distinct answered questions). */
export function welcomeEligible(user: EntitlementUser, distinctAnswered: number | null, minQuestions: number): boolean {
  if (user.is_banned === true) return false;
  if (isVerifiedAccount(user)) return true;
  return distinctAnswered !== null && distinctAnswered >= minQuestions;
}

/**
 * The welcome decision's reads, in order of cost: the lot key, then (only for
 * an unverified account) its distinct answered questions, then this Vienna
 * month's welcome lots against the breaker. null = no welcome lot now.
 * Throws on a read error (the caller skips the bonus, never 503s for it).
 */
export async function decideWelcome(sb: Db, user: EntitlementUser, fc: FreeCreditConfig, now: Date): Promise<{ micro: number; expiryDays: number } | null> {
  if (!fc.welcomeEnabled || user.is_banned === true) return null;
  const existing = await sb.from("ai_credit_lot").select("id").eq("source", "welcome_taste").eq("source_id", user.id).limit(1);
  if (existing.error) throw new Error(`welcome lot read failed: ${existing.error.code ?? "unknown"}`);
  if ((existing.data ?? []).length > 0) return null;
  let distinct: number | null = null;
  if (!isVerifiedAccount(user)) {
    const answers = await sb.from("answer_history").select("question_id").eq("user_id", user.id).limit(200);
    if (answers.error) throw new Error(`welcome activity read failed: ${answers.error.code ?? "unknown"}`);
    distinct = new Set(((answers.data ?? []) as Array<{ question_id: number | null }>).map((r) => r.question_id).filter((q) => q !== null)).size;
  }
  if (!welcomeEligible(user, distinct, fc.welcomeMinQuestions)) return null;
  if (fc.welcomeMonthlyCap <= 0) return null;
  const month = await sb.from("ai_credit_lot").select("id").eq("source", "welcome_taste")
    .gte("created_at", viennaMonthStart(now).toISOString()).limit(fc.welcomeMonthlyCap);
  if (month.error) throw new Error(`welcome breaker read failed: ${month.error.code ?? "unknown"}`);
  if ((month.data ?? []).length >= fc.welcomeMonthlyCap) {
    Sentry.captureMessage("mentor welcome breaker reached for this Vienna month", { level: "warning", tags: { route: "mentor-wallet", step: "welcome_breaker" } });
    return null;
  }
  return { micro: creditsToMicro(fc.welcomeCredits), expiryDays: fc.welcomeExpiryDays };
}

export function createWallet(sb: Db, opts: WalletOptions = {}): Wallet {
  const freeEnabled = opts.freeEnabled ?? readMentorConfig().freeEnabled;
  const fc = opts.freeCredits ?? readFreeCreditConfig();

  return {
    async ensureIncludedGrants(userId: string, now: Date): Promise<void> {
      if (!isUuid(userId)) throw new Error("ensureIncludedGrants: invalid user id");

      const [userRes, subsRes] = await Promise.all([
        sb.from("users").select("id, role, tier, tier_expires_at, email_verified_at, telegram_id, is_banned").eq("id", userId).maybeSingle(),
        sb
          .from("subscriptions")
          .select("id, tier, status, payment_provider, amount_cents, started_at, expires_at")
          .eq("user_id", userId)
          .eq("status", "active"),
      ]);
      if (userRes.error) throw new Error(`users read failed: ${userRes.error.code ?? "unknown"}`);
      if (subsRes.error) throw new Error(`subscriptions read failed: ${subsRes.error.code ?? "unknown"}`);
      const user = (userRes.data as EntitlementUser | null) ?? null;
      if (!user) return;
      const subs = ((subsRes.data as EntitlementSub[] | null) ?? []).filter((s) => s && typeof s.id === "string");

      // Referral lookup only matters for Pro granted through users.tier.
      let referrals: EntitlementReferral[] = [];
      if (user.tier === "pro") {
        const refRes = await sb
          .from("referrals")
          .select("id, rewarded_at")
          .eq("referrer_user_id", userId)
          .eq("reward_type", "pro_until_exam")
          .eq("status", "rewarded")
          .order("rewarded_at", { ascending: false })
          .limit(1);
        if (refRes.error) throw new Error(`referrals read failed: ${refRes.error.code ?? "unknown"}`);
        referrals = (refRes.data as EntitlementReferral[] | null) ?? [];
      }

      const catalogue = await loadPackageCatalogue(sb, now.getTime());
      const packages = new Map<MentorPackageId, IncludedPackageRow>();
      for (const [id, row] of catalogue) {
        packages.set(id, { package_id: id, grant_micro: row.grant_micro, expiry_days: row.expiry_days, active: row.active });
      }

      // While the welcome lot is on it replaces the facts-only free taste for new grants.
      const snap: EntitlementSnapshot = {
        user, subs, referrals, packages,
        freeEnabled: freeEnabled && !fc.welcomeEnabled,
        amounts: includedAmountOverrides(fc),
      };
      const first = planIncludedGrantsDetailed(snap, now);
      const branch = first.branch;
      let plan = first.grants;
      let welcome = false;
      if (branch === "free" && plan.length === 0 && fc.welcomeEnabled) {
        try {
          const w = await decideWelcome(sb, user, fc, now);
          if (w) {
            plan = planIncludedGrantsDetailed({ ...snap, welcome: w }, now).grants;
            welcome = plan.length > 0;
          }
        } catch (err) {
          Sentry.captureMessage(`mentor welcome decision skipped: ${String((err as Error)?.message ?? err)}`, "warning");
        }
      }
      for (const g of plan) {
        const r = await rpcGrantCredits(sb, g);
        if (r.ok) continue;
        if (welcome) {
          // A bonus never blocks the mentor (e.g. the flag set before the changeset).
          Sentry.captureMessage(`mentor welcome grant skipped (${r.reason ?? "unknown"})`, "warning");
          continue;
        }
        if (r.reason === "source_conflict") {
          // Another user already holds this key: never fund twice, flag it.
          Sentry.captureMessage(`mentor included grant source_conflict ${g.source}:${g.sourceId}`, "warning");
          continue;
        }
        if (r.reason === "zero_grant" || r.reason === "unknown_package" || r.reason === "invalid_args") {
          Sentry.captureMessage(`mentor included grant skipped (${r.reason}) for package ${g.packageId}`, "warning");
          continue;
        }
        throw new Error(`mentor included grant failed: ${r.reason ?? "unknown"}`);
      }
    },

    async balance(userId: string): Promise<WalletBalance> {
      return toWalletBalance(await rpcBalance(sb, userId));
    },

    async avgMessageCostMicro(userId: string): Promise<number | null> {
      if (!isUuid(userId)) return null;
      try {
        const { data, error } = await sb
          .from("ai_usage_ledger")
          .select("request_id, delta_micro_usd")
          .eq("user_id", userId)
          .eq("kind", "settle")
          .order("created_at", { ascending: false })
          .limit(AVG_WINDOW_MESSAGES * 3);
        if (error || !Array.isArray(data)) return null;
        return averageMessageCost(data as Array<{ request_id: string | null; delta_micro_usd: number | string | null }>);
      } catch {
        // Display-only estimate: an error falls back to 1 credit per message.
        return null;
      }
    },

    async accessSources(userId: string): Promise<MentorAccessSource[]> {
      const b = await rpcBalance(sb, userId);
      return accessSourcesFromLots(toWalletBalance(b).lots);
    },
  };
}
