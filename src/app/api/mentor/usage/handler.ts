/**
 * GET /api/mentor/usage handler (W2-CORE): credits and state for the UI.
 * Learners see whole credits. The legacy estimate is retained on the wire,
 * but the mentor UI explains variable message cost instead of displaying it.
 * No model call, but it does DB writes (included grants) and spend scans, so
 * it is rate limited per user and the breaker read is cached (review M5).
 * Every DB gate still fails closed.
 */

import type { RpcClient } from "@/lib/ai/limits";
import {
  mentorLowThreshold,
  creditsFromMicro,
  creditsExactFromMicro,
  mentorWhopPlanId,
  messagesLeftEstimate,
  type MentorConfig,
  type MentorSoldPackageId,
} from "@/lib/mentor/config";
import type { MentorAccessSource, MentorUsageResponse, MentorUsageState } from "@/lib/mentor/contract";
import { checkMentorAdmission, mentorError, mentorResting, type FlagFn, type MentorServices, type RestingFn } from "@/lib/mentor/guard";
import type { Clock, WalletLot } from "@/lib/mentor/seam";
import { freshMessageAdmissionMicro } from "@/lib/mentor/turn";
import { authFailureError, errorResponse, type MentorAuth } from "../chat/handler";
import { TICKET_HOUSE_GRANT_TIERS, houseGrantsAllowed, ticketOnlyHouseGrants, type MentorScopeReads } from "@/lib/mentor/access";
import type { HouseGrantsScope } from "@/lib/mentor/credits/free-credits";
import { fundedOnlyByFreeLots } from "@/lib/mentor/credits/house-cap";

export interface UsageHandlerDeps {
  config: MentorConfig;
  env: Record<string, string | undefined>;
  authenticate(req: Request): Promise<MentorAuth>;
  flag: FlagFn;
  betaAllowed?(userId: string): Promise<boolean>;
  /** MENTOR_ACCESS_SCOPE reads (src/lib/mentor/access.ts); omitted = allowlist only. */
  scopeReads?(userId: string, paidAccess: boolean): MentorScopeReads;
  /** MENTOR_HOUSE_GRANTS_SCOPE; omitted = allowlist only (today). */
  houseGrantsScope?: HouseGrantsScope;
  /** Any free credit hook on (houseCapConsidered); omitted = off, the response is unchanged. */
  freeCreditHooksOn?: boolean;
  /** Referral credit amount while REFERRAL_MENTOR_CREDITS_ENABLED is on and this account may refer, else null. Called after authenticate. */
  referralCredits?(): number | null;
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
  /** R5: skip ensureIncludedGrants when this instance ran it for the user recently. Omitted = every call. */
  grantsMemo?: GrantsMemo;
}

/**
 * MUX-23: "exhausted" means below the admission bar of a new message, the
 * number admitTurn uses (turn.ts admissionMinMicro). Without that number the
 * view falls back to "anything left".
 */
export function computeUsageState(args: {
  resting: boolean | null;
  everGranted: boolean;
  availableMicro: number;
  admitMinMicro: number | null;
  currentGrantCredits?: number;
}): MentorUsageState {
  if (args.resting === true) return "resting";
  if (!args.everGranted) return "none";
  const admit = args.admitMinMicro !== null ? args.availableMicro >= args.admitMinMicro : args.availableMicro > 0;
  if (!admit) return "exhausted";
  if (creditsFromMicro(args.availableMicro) < mentorLowThreshold(args.currentGrantCredits ?? 0)) return "low";
  return "ok";
}

export function computeCanBuy(config: MentorConfig, env: Record<string, string | undefined>, active: Set<string>): boolean {
  if (!config.packagesEnabled) return false;
  const sold: MentorSoldPackageId[] = config.topupsEnabled ? ["mentor_basis", "mentor_plus", "mentor_topup"] : ["mentor_basis", "mentor_plus"];
  return sold.some((p) => mentorWhopPlanId(p, env) !== null && active.has(p));
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Runs a read and settles it (a synchronous throw counts as a failure too). */
function settle<T>(read: () => Promise<T> | T): Promise<Settled<T>> {
  return (async () => read())().then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

/** R5: how long one instance trusts its last successful ensureIncludedGrants for a user. */
export const GRANTS_MEMO_MS = 5 * 60_000;
const GRANTS_MEMO_MAX = 5_000;

export interface GrantsMemo {
  fresh(userId: string, nowMs: number): boolean;
  mark(userId: string, nowMs: number): void;
}

/** Per-instance memo of successful included-grant runs (bounded, oldest dropped first). */
export function createGrantsMemo(ttlMs = GRANTS_MEMO_MS, max = GRANTS_MEMO_MAX): GrantsMemo {
  const at = new Map<string, number>();
  return {
    fresh: (userId, nowMs) => {
      const last = at.get(userId);
      return last !== undefined && nowMs - last >= 0 && nowMs - last < ttlMs;
    },
    mark: (userId, nowMs) => {
      at.delete(userId);
      at.set(userId, nowMs);
      while (at.size > max) at.delete(at.keys().next().value as string);
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function handleMentorUsage(req: Request, d: UsageHandlerDeps): Promise<Response> {
  const auth = await d.authenticate(req);
  if (!auth.ok) return errorResponse(authFailureError(auth.reason));
  const { userId } = auth;

  const gate = d.rateLimit?.(userId);
  if (gate && !gate.allowed) return errorResponse(mentorError("rate_limited", { retry_after_seconds: Math.max(1, gate.retryAfterSec) }));

  const admission = await checkMentorAdmission(d.config, userId, d.flag, d.betaAllowed, d.scopeReads?.(userId, auth.paidAccess));
  const denied = admission.error;


  const houseGrants = houseGrantsAllowed(d.houseGrantsScope, admission.via);
  const services = d.services();
  if (!services) {
    d.alert("mentor services not wired (resolveMentorServices returned null)", { route: "/api/mentor/usage", userId });
    return errorResponse(mentorError("reserve_failed"));
  }
  const now = d.clock.now();
  // R5 (a-mentor-reliability): reads that do not depend on the wallet start now
  // and run while grants and the balance load. Each is settled at creation, so
  // an early return never leaves a rejected promise behind.
  // A denied caller starts them only once the balance shows it keeps read-only access.
  const startReads = () => ({
    subscriptions: settle(() => d.subscriptions(userId)),
    packageIds: settle(() => d.activePackageIds()),
    breaker: denied ? Promise.resolve<Settled<boolean | null>>({ ok: true, value: false }) : settle(() => (d.resting ?? mentorResting)(d.rpc, d.config, now)),
    pending: settle(async () => (await d.pendingPurchase?.(userId)) ?? null),
    recent: settle(async () => (await d.recentPurchase?.(userId)) ?? null),
  });
  let early = denied ? null : startReads();
  // R5: ensureIncludedGrants at most once per user and paid state per instance
  // within GRANTS_MEMO_MS (chat runs it on every turn). A memo hit with nothing
  // to spend runs it anyway, so a grant that just became due (trial, Pro) shows.
  // a-pricing-v2: a scope-admitted Guarantee Ticket holder still gets the ticket's included credits.
  const ticketOnly = !houseGrants && ticketOnlyHouseGrants(d.houseGrantsScope, admission.via);
  const runsGrants = houseGrants || ticketOnly;
  const memoKey = `${userId}:${auth.paidAccess ? "paid" : "free"}${ticketOnly ? ":ticket" : ""}`;
  const runGrants = async (): Promise<Response | null> => {
    try {
      // House-funded grants where houseGrantsAllowed says so (src/lib/mentor/access.ts).
      if (ticketOnly) await services.wallet.ensureIncludedGrants(userId, now, { onlyTiers: TICKET_HOUSE_GRANT_TIERS });
      else await services.wallet.ensureIncludedGrants(userId, now);
      d.grantsMemo?.mark(memoKey, now.getTime());
      return null;
    } catch (err) {
      d.alert(`ensureIncludedGrants failed: ${String((err as Error)?.message ?? err)}`, { route: "/api/mentor/usage", userId });
      return errorResponse(mentorError("reserve_failed"));
    }
  };
  const memoHit = runsGrants && !!d.grantsMemo?.fresh(memoKey, now.getTime());
  if (runsGrants && !memoHit) {
    const failed = await runGrants();
    if (failed) return failed;
  }

  let balance: Awaited<ReturnType<MentorServices["wallet"]["balance"]>>;
  try {
    balance = await services.wallet.balance(userId);
    if (memoHit && balance.availableMicro <= 0) {
      const failed = await runGrants();
      if (failed) return failed;
      balance = await services.wallet.balance(userId);
    }
  } catch {
    return errorResponse(mentorError("reserve_failed"));
  }
  if (denied && !balance.everGranted) return errorResponse(denied);
  early ??= startReads();
  const { subscriptions: subscriptionsRead, packageIds: packageIdsRead, breaker: breakerRead, pending: pendingRead, recent: recentRead } = early;
  // Lot-dependent reads, together (each keeps its own fallback below).
  const balanceTrialLot = balance.lots.find(l => l.kind === "trial") ?? null;
  const [avgRead, sourcesRead, includedRead, trialGrantRead, subscriptionsDone, packageIdsDone, breakerDone, pendingDone, recentDone] = await Promise.all([
    settle(() => services.wallet.avgMessageCostMicro(userId)),
    settle(() => services.wallet.accessSources(userId)),
    settle(async () => d.includedAllowance?.(userId, balance, now)),
    balanceTrialLot || !d.trialGrant ? Promise.resolve<Settled<WalletLot | null>>({ ok: true, value: balanceTrialLot }) : settle(() => d.trialGrant!(userId)),
    subscriptionsRead, packageIdsRead, breakerRead, pendingRead, recentRead,
  ]);
  const avg: number | null = avgRead.ok ? avgRead.value : null;
  const sources: MentorAccessSource[] = sourcesRead.ok ? sourcesRead.value : ["none"];
  let subscriptions: MentorUsageResponse["subscriptions"] = [];
  if (subscriptionsDone.ok) subscriptions = subscriptionsDone.value;
  else d.alert("mentor subscriptions read failed", { route: "/api/mentor/usage", userId });
  let canBuy = false;
  if (packageIdsDone.ok) canBuy = computeCanBuy(d.config, d.env, packageIdsDone.value);
  const breaker = breakerDone.ok ? breakerDone.value : null;
  if (breaker === null) return errorResponse(mentorError("reserve_failed"));
  const resting = !!denied || breaker;
  if (!pendingDone.ok || !recentDone.ok) return errorResponse(mentorError("reserve_failed"));
  const pendingPurchase: MentorUsageResponse["pending_purchase"] = pendingDone.value;
  const recentPurchase: MentorUsageResponse["recent_purchase"] = recentDone.value;

  // Include spent-but-live lots so exhausted copy retains the source. Never turn expiry into a renewal.
  const currentLot = [...balance.lots].filter(l => Date.parse(l.startsAt) <= now.getTime() && Date.parse(l.expiresAt) > now.getTime()).sort((a,b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0];
  const grantCredits = currentLot ? creditsFromMicro(currentLot.grantedMicro) : 0;
  // Display-only data: a failed read omits unproven copy.
  const included: MentorUsageResponse["included_allowance"] = includedRead.ok ? includedRead.value : undefined;
  // No unverified trial copy when the trial read failed.
  const trialLot = trialGrantRead.ok ? trialGrantRead.value : null;
  // The "Pro includes N credits" line only for accounts that receive included grants.
  const proIncludedCredits = trialLot && houseGrants ? await d.trialProIncludedCredits?.().catch(() => null) : null;
  const trial = trialLot ? {
    ...(typeof proIncludedCredits === "number" ? { pro_included_credits: proIncludedCredits } : {}),
    credits: creditsExactFromMicro(trialLot.grantedMicro),
    credits_left: Date.parse(trialLot.expiresAt) > now.getTime() ? creditsExactFromMicro(trialLot.remainingMicro) : 0,
    expires_at: trialLot.expiresAt,
    expired: Date.parse(trialLot.expiresAt) <= now.getTime(),
    ...(trialLot.source === "free_taste" ? { free_taste: true } : {}),
  } : undefined;
  const source: MentorAccessSource = currentLot ? ({subscription:"package",topup:"package",included:"pro_included",unknown:"pro_included",trial:"trial",gift:"gift",referral:"gift",admin:"admin",free:"none"} as const)[currentLot.kind] : trial?.expired ? "trial" : "none";
  const admitMinMicro = freshMessageAdmissionMicro({ brain: services.brain, config: d.config, clock: d.clock }, userId);
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
      admitMinMicro,
      currentGrantCredits: grantCredits,
    }),
    credits_left: creditsExactFromMicro(balance.availableMicro),
    admit_min_credits: admitMinMicro === null ? null : creditsExactFromMicro(admitMinMicro),
    messages_left_estimate: messagesLeftEstimate(balance.availableMicro, avg),
    next_expiry: balance.nextExpiry ?? currentLot?.expiresAt ?? null,
    sources,
    subscriptions,
    can_buy: canBuy && !resting,
    ...(resting ? { reason: "paused" as const, resting_until: breaker ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() : null } : {}),
    pending_purchase: pendingPurchase,
    recent_purchase: recentPurchase,
    ...(admission.via === "scope" && !houseGrants ? { credits_only: true as const } : {}),
    // Point 6 (a-free-credit-hooks): packages only once free credits run low.
    ...(d.freeCreditHooksOn && fundedOnlyByFreeLots(balance.lots, now.getTime()) ? { free_credits_only: true as const } : {}),
    ...(() => { const n = d.referralCredits?.(); return typeof n === "number" && n > 0 ? { referral_credits: n } : {}; })(),
  };
  return json(response);
}
