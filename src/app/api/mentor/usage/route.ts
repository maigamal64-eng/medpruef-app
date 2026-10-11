import type { NextRequest } from "next/server";
import { flag } from "@/lib/admin/flags";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { readMentorConfig } from "@/lib/mentor/config";
import { createRestingCache, resolveMentorServices } from "@/lib/mentor/guard";
import { readActiveMentorSubscriptions, readActivePackageIds } from "@/lib/mentor/ledger";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { getServiceClient } from "@/lib/supabase";
import type { MentorAuth } from "../chat/handler";
import { readPendingPurchase } from "@/lib/mentor/credits/purchases";
import { creditsFromMicro, creditsExactFromMicro } from "@/lib/mentor/config";
import { mentorBetaAllowed } from "@/lib/mentor/beta";
import { TIER_TO_INCLUDED } from "@/lib/mentor/credits/included";
import { includedAllowance } from "@/lib/mentor/credits/included-allowance";
import { loadPackageCatalogue } from "@/lib/mentor/credits/packages";
import { handleMentorUsage } from "./handler";

export const dynamic = "force-dynamic";

/** 30 reads a minute per user (the page polls; a loop does not get to scan the ledger). */
const USAGE_LIMIT_PER_MIN = 30;
const restingCached = createRestingCache(60_000);

/** GET /api/mentor/usage (contract C4): credits left, state, sources, subscriptions. */
export async function GET(req: NextRequest) {
  const db = getServiceClient();
  const config = readMentorConfig();
  return handleMentorUsage(req, {
    config,
    betaAllowed: userId => mentorBetaAllowed(db, userId, config.betaUserIds),
    env: process.env,
    async authenticate(request): Promise<MentorAuth> {
      const guard = await requireUser(request as NextRequest);
      if ("error" in guard) return { ok: false };
      return { ok: true, userId: guard.userId, paidAccess: isPaidAccess(guard) };
    },
    flag: (key, userId) => flag(key, userId, { fresh: true }),
    rpc: db,
    services: () => resolveMentorServices(db),
    clock: { now: () => new Date() },
    pendingPurchase: (userId) => readPendingPurchase(db, userId),
    recentPurchase: async (userId) => {
      const { data, error } = await db.from("ai_mentor_purchase").select("checkout_session_id,granted_micro,granted_at")
        .eq("user_id", userId).eq("status", "granted").gte("granted_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .order("granted_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("recent mentor purchase read failed");
      return data ? { checkout_session_id: data.checkout_session_id, credits_added: creditsFromMicro(Number(data.granted_micro)), granted_at: data.granted_at } : null;
    },
    trialProIncludedCredits: async () => {
      const row = (await loadPackageCatalogue(db)).get("included_pro_monthly");
      return row?.active ? creditsExactFromMicro(row.grant_micro) : null;
    },
    trialGrant: async (userId) => {
      const { data, error } = await db.from("ai_credit_lot").select("id,package_id,source,granted_micro,spent_micro,clawed_back_micro,starts_at,expires_at")
        .eq("user_id", userId).eq("source", "trial_taste").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("trial grant read failed");
      return data ? { lotId:data.id,packageId:data.package_id,kind:"trial",source:data.source,grantedMicro:Number(data.granted_micro),remainingMicro:Math.max(0,Number(data.granted_micro)-Number(data.spent_micro)-Number(data.clawed_back_micro)),startsAt:data.starts_at,expiresAt:data.expires_at } : null;
    },
    subscriptions: (userId) => readActiveMentorSubscriptions(db, userId),
    activePackageIds: () => readActivePackageIds(db),
    includedAllowance: async (userId, balance, now) => {
      const { data, error } = await db.from("subscriptions").select("tier,payment_provider,amount_cents,expires_at")
        .eq("user_id", userId).eq("status", "active").gt("expires_at", now.toISOString());
      if (error) return undefined;
      const current = balance.lots.filter(lot => lot.source === "pro_included" && Date.parse(lot.startsAt) <= now.getTime() && Date.parse(lot.expiresAt) > now.getTime()).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
      const ends = (data ?? []).filter(row => current && TIER_TO_INCLUDED[row.tier] === current.packageId && row.payment_provider !== "manual" && Number(row.amount_cents) > 0)
        .map(row => row.expires_at).filter((end): end is string => typeof end === "string");
      return includedAllowance(balance, await loadPackageCatalogue(db), ends, now);
    },
    alert: (message, ctx) => captureServerError(new Error(message), ctx),
    rateLimit: (userId) => {
      const g = checkRateLimit({ key: rateKey("mentor-usage", userId), limit: USAGE_LIMIT_PER_MIN, windowMs: 60_000 });
      return { allowed: g.allowed, retryAfterSec: g.retryAfterSec };
    },
    resting: restingCached,
  });
}
