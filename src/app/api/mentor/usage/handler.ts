/**
 * GET /api/mentor/usage handler (W2-CORE): credits and state for the UI.
 * Learners see whole credits. The legacy estimate is retained on the wire,
 * but the mentor UI explains variable message cost instead of displaying it.
 * No model call, but it does DB writes (included grants) and spend scans, so
 * it is rate limited per user and the breaker read is cached (review M5).
 * Every DB gate still fails closed.
 */

import type { RpcClient } from "@/lib/ai/limits";
import { reserveCeilingMicro } from "@/lib/ai/pricing";
import {
  mentorLowThreshold,
  canAdmitMessage,
  creditsFromMicro,
  creditsExactFromMicro,
  mentorWhopPlanId,
  messagesLeftEstimate,
  type MentorConfig,
  type MentorSoldPackageId,
} from "@/lib/mentor/config";
import type { MentorAccessSource, MentorUsageResponse, MentorUsageState } from "@/lib/mentor/contract";
import { checkMentorAccess, mentorError, mentorResting, type FlagFn, type MentorServices, type RestingFn } from "@/lib/mentor/guard";
import type { Clock } from "@/lib/mentor/seam";
import { errorResponse, type MentorAuth } from "../chat/handler";

/**
 * Nominal input size of a first call (system + fact sheet + tools + a short
 * question). Only the usage view uses it to decide "exhausted"; the chat
 * route admits against the real first-call ceiling.
 */
export const NOMINAL_FIRST_CALL_INPUT_BYTES = 12_000;

export interface UsageHandlerDeps {
  config: MentorConfig;
  env: Record<string, string | undefined>;
  authenticate(req: Request): Promise<MentorAuth>;
  flag: FlagFn;
  betaAllowed?(userId: string): Promise<boolean>;
  rpc: RpcClient;
  services(): MentorServices | null;
  clock: Clock;
  /** Active mentor Whop memberships. Throws on DB error. */
  subscriptions(userId: string): Promise<MentorUsageResponse["subscriptions"]>;
  pendingPurchase?(userId: string): Promise<MentorUsageResponse["pending_purchase"]>;
  recentPurchase?(userId: string): Promise<MentorUsageResponse["recent_purchase"]>;
  trialProIncludedCredits?(): Promise<number | null>;
  trialGrant?(userId: string): Promise<import("@/lib/mentor/seam").WalletLot | null>;
  includedAllowance?(userId: string, balance: Awaited<ReturnType<MentorServices["wallet"]["balance"]>>, now: Date): Promise<MentorUsageResponse["included_allowance"]>;
  /** Package ids with an active catalogue row. Throws on DB error. */
  activePackageIds(): Promise<Set<string>>;
  alert(message: string, ctx: Record<string, string | number | boolean | null | undefined>): void;
  /** Per-user limiter (review M5). Omitted in unit tests; the route always passes it. */
  rateLimit?(userId: string): { allowed: boolean; retryAfterSec: number };
  /** Cached breaker read. Defaults to the uncached mentorResting. */
  resting?: RestingFn;
}

export function nominalAdmitCeiling(config: MentorConfig): number | null {
  try {
    return reserveCeilingMicro(config.modelDefault, NOMINAL_FIRST_CALL_INPUT_BYTES, config.maxTokens);
  } catch {
    return null;
  }
}

export function computeUsageState(args: {
  resting: boolean | null;
  everGranted: boolean;
  availableMicro: number;
  nominalCeilingMicro: number | null;
  maxToolRounds: number;
  currentGrantCredits?: number;
}): MentorUsageState {
  if (args.resting === true) return "resting";
  if (!args.everGranted) return "none";
  const admit =
    args.nominalCeilingMicro !== null
      ? canAdmitMessage(args.availableMicro, args.nominalCeilingMicro, args.maxToolRounds)
      : args.availableMicro > 0;
  if (!admit) return "exhausted";
  if (creditsFromMicro(args.availableMicro) < mentorLowThreshold(args.currentGrantCredits ?? 0)) return "low";
  return "ok";
}

export function computeCanBuy(config: MentorConfig, env: Record<string, string | undefined>, active: Set<string>): boolean {
  if (!config.packagesEnabled) return false;
  const sold: MentorSoldPackageId[] = config.topupsEnabled ? ["mentor_basis", "mentor_plus", "mentor_topup"] : ["mentor_basis", "mentor_plus"];
  return sold.some((p) => mentorWhopPlanId(p, env) !== null && active.has(p));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function handleMentorUsage(req: Request, d: UsageHandlerDeps): Promise<Response> {
  const auth = await d.authenticate(req);
  if (!auth.ok) return errorResponse(mentorError("unauthenticated"));
  const { userId } = auth;

  const gate = d.rateLimit?.(userId);
  if (gate && !gate.allowed) return errorResponse(mentorError("rate_limited", { retry_after_seconds: Math.max(1, gate.retryAfterSec) }));

  const denied = await checkMentorAccess(d.config, userId, d.flag, d.betaAllowed);


  const services = d.services();
  if (!services) {
    d.alert("mentor services not wired (resolveMentorServices returned null)", { route: "/api/mentor/usage", userId });
    return errorResponse(mentorError("reserve_failed"));
  }
  const now = d.clock.now();
  try {
    if (!denied) await services.wallet.ensureIncludedGrants(userId, now);
  } catch (err) {
    d.alert(`ensureIncludedGrants failed: ${String((err as Error)?.message ?? err)}`, { route: "/api/mentor/usage", userId });
    return errorResponse(mentorError("reserve_failed"));
  }

  let balance: Awaited<ReturnType<MentorServices["wallet"]["balance"]>>;
  try {
    balance = await services.wallet.balance(userId);
  } catch {
    return errorResponse(mentorError("reserve_failed"));
  }
  if (denied && !balance.everGranted) return errorResponse(denied);
  let avg: number | null = null;
  try {
    avg = await services.wallet.avgMessageCostMicro(userId);
  } catch {
    avg = null;
  }
  let sources: MentorAccessSource[] = ["none"];
  try {
    sources = await services.wallet.accessSources(userId);
  } catch {
    sources = ["none"];
  }
  let subscriptions: MentorUsageResponse["subscriptions"] = [];
  try {
    subscriptions = await d.subscriptions(userId);
  } catch {
    d.alert("mentor subscriptions read failed", { route: "/api/mentor/usage", userId });
  }
  let canBuy = false;
  try {
    canBuy = computeCanBuy(d.config, d.env, await d.activePackageIds());
  } catch {
    canBuy = false;
  }
  const breaker = denied ? false : await (d.resting ?? mentorResting)(d.rpc, d.config, now);
  if (breaker === null) return errorResponse(mentorError("reserve_failed"));
  const resting = !!denied || breaker;
  let pendingPurchase: MentorUsageResponse["pending_purchase"] = null;
  let recentPurchase: MentorUsageResponse["recent_purchase"] = null;
  try {
    pendingPurchase = await d.pendingPurchase?.(userId) ?? null;
    recentPurchase = await d.recentPurchase?.(userId) ?? null;
  } catch { return errorResponse(mentorError("reserve_failed")); }

  // Include spent-but-live lots so exhausted copy retains the source. Never turn expiry into a renewal.
  const currentLot = [...balance.lots].filter(l => Date.parse(l.startsAt) <= now.getTime() && Date.parse(l.expiresAt) > now.getTime()).sort((a,b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
  const grantCredits = currentLot ? creditsFromMicro(currentLot.grantedMicro) : 0;
  let included: MentorUsageResponse["included_allowance"];
  try { included = await d.includedAllowance?.(userId, balance, now); } catch { /* Display-only data: omit unproven copy. */ }
  let trialLot = balance.lots.find(l => l.kind === "trial") ?? null;
  if (!trialLot && d.trialGrant) {
    try { trialLot = await d.trialGrant(userId); } catch { /* No unverified trial copy. */ }
  }
  const proIncludedCredits = trialLot ? await d.trialProIncludedCredits?.().catch(() => null) : null;
  const trial = trialLot ? {
    ...(typeof proIncludedCredits === "number" ? { pro_included_credits: proIncludedCredits } : {}),
    credits: creditsExactFromMicro(trialLot.grantedMicro),
    credits_left: Date.parse(trialLot.expiresAt) > now.getTime() ? creditsExactFromMicro(trialLot.remainingMicro) : 0,
    expires_at: trialLot.expiresAt,
    expired: Date.parse(trialLot.expiresAt) <= now.getTime(),
  } : undefined;
  const source: MentorAccessSource = currentLot ? ({subscription:"package",topup:"package",included:"pro_included",unknown:"pro_included",trial:"trial",gift:"gift",referral:"gift",admin:"admin",free:"none"} as const)[currentLot.kind] : trial?.expired ? "trial" : "none";
  const response: MentorUsageResponse = {
    source,
    ...(trial ? { trial } : {}),
    ...(included ? { included_allowance: included } : {}),
    low_threshold: mentorLowThreshold(grantCredits),
    current_grant: grantCredits,
    ...(currentLot ? { source_package: currentLot.packageId } : {}),
    renewal_at: subscriptions.find(s => s.renews && s.renews_at)?.renews_at ?? null,
    state: computeUsageState({
      resting,
      everGranted: balance.everGranted,
      availableMicro: balance.availableMicro,
      nominalCeilingMicro: nominalAdmitCeiling(d.config),
      maxToolRounds: d.config.maxToolRounds,
      currentGrantCredits: grantCredits,
    }),
    credits_left: creditsExactFromMicro(balance.availableMicro),
    messages_left_estimate: messagesLeftEstimate(balance.availableMicro, avg),
    next_expiry: balance.nextExpiry ?? currentLot?.expiresAt ?? null,
    sources,
    subscriptions,
    can_buy: canBuy && !resting,
    ...(resting ? { reason: "paused" as const, resting_until: breaker ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() : null } : {}),
    pending_purchase: pendingPurchase,
    recent_purchase: recentPurchase,
  };
  return json(response);
}
