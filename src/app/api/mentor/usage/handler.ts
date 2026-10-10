/**
 * GET /api/mentor/usage handler (W2-CORE): credits and state for the UI.
 * Learners never see dollars: whole credits and an "about N messages" estimate.
 * Not rate limited (no model call); every DB gate still fails closed.
 */

import type { RpcClient } from "@/lib/ai/limits";
import { reserveCeilingMicro } from "@/lib/ai/pricing";
import {
  MENTOR_LOW_CREDITS,
  canAdmitMessage,
  creditsFromMicro,
  mentorWhopPlanId,
  messagesLeftEstimate,
  type MentorConfig,
  type MentorSoldPackageId,
} from "@/lib/mentor/config";
import type { MentorAccessSource, MentorPackageId, MentorUsageResponse, MentorUsageState } from "@/lib/mentor/contract";
import { checkMentorAccess, mentorError, mentorResting, type FlagFn, type MentorServices } from "@/lib/mentor/guard";
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
  rpc: RpcClient;
  services(): MentorServices | null;
  clock: Clock;
  /** Active mentor Whop memberships. Throws on DB error. */
  subscriptions(userId: string): Promise<Array<{ package_id: MentorPackageId; renews: boolean }>>;
  /** Package ids with an active catalogue row. Throws on DB error. */
  activePackageIds(): Promise<Set<string>>;
  alert(message: string, ctx: Record<string, string | number | boolean | null | undefined>): void;
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
}): MentorUsageState {
  if (args.resting === true) return "resting";
  if (!args.everGranted) return "none";
  const admit =
    args.nominalCeilingMicro !== null
      ? canAdmitMessage(args.availableMicro, args.nominalCeilingMicro, args.maxToolRounds)
      : args.availableMicro > 0;
  if (!admit) return "exhausted";
  if (creditsFromMicro(args.availableMicro) < MENTOR_LOW_CREDITS) return "low";
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

  const denied = await checkMentorAccess(d.config, userId, d.flag);
  if (denied) return errorResponse(denied);

  const services = d.services();
  if (!services) {
    d.alert("mentor services not wired (resolveMentorServices returned null)", { route: "/api/mentor/usage", userId });
    return errorResponse(mentorError("reserve_failed"));
  }
  const now = d.clock.now();
  try {
    await services.wallet.ensureIncludedGrants(userId, now);
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
  const resting = await mentorResting(d.rpc, d.config, now);

  const response: MentorUsageResponse = {
    state: computeUsageState({
      resting,
      everGranted: balance.everGranted,
      availableMicro: balance.availableMicro,
      nominalCeilingMicro: nominalAdmitCeiling(d.config),
      maxToolRounds: d.config.maxToolRounds,
    }),
    credits_left: creditsFromMicro(balance.availableMicro),
    messages_left_estimate: messagesLeftEstimate(balance.availableMicro, avg),
    next_expiry: balance.nextExpiry,
    sources,
    subscriptions,
    can_buy: canBuy,
  };
  return json(response);
}
