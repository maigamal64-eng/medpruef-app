/**
 * Mentor guard (W2-CORE): the gates every mentor request passes, in order.
 *
 *   1. auth                                   401 unauthenticated
 *   2. AI_FEATURES_ENABLED                     503 ai_disabled
 *   3. MENTOR_ENABLED, beta allowlist, DB flag 403 mentor_disabled
 *   4. input (chat only)                       400 invalid_input / 413 input_too_large
 *   5. attempt rate limit (chat only)          429 rate_limited / 503 reserve_failed
 *   6. global spend breaker                    503 global_cap / 503 reserve_failed
 *   7. wallet: included grants, balance, admission (handler + turn.ts)
 *
 * Every DB-backed gate fails CLOSED. No flag turns metering off. Admission
 * is frozen as config.ts canAdmitMessage and checked through turn.ts
 * admitTurn so the HTTP 402 and the turn loop use the same ceiling.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkGlobalSpend, type RpcClient } from "@/lib/ai/limits";
import { type MentorConfig, MENTOR_DB_FLAG_KEY } from "./config";
import {
  MENTOR_ERROR_STATUS,
  MENTOR_LANGS,
  MENTOR_MESSAGE_MAX_CHARS,
  MENTOR_MODES,
  type MentorChatRequest,
  type MentorErrorBody,
  type MentorErrorCode,
} from "./contract";
import { rpcAttemptTake } from "./ledger";
import type { Brain, FactsLoader, Wallet } from "./seam";
import { getMentorFactsLoader } from "./facts-loader";
import { createMentorBrain, type MentorBrain } from "./prompt/brain";
import { createWallet } from "./credits/wallet";

/** Where the UI sends a learner without credits (W2-UI owns the page). */
export const MENTOR_PACKAGES_URL = "/mentor/packages";

/** Raw request bodies above this are refused before JSON parsing. */
export const MENTOR_MAX_BODY_BYTES = 16_384;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Errors ─────────────────────────────────────────────────────────────

export interface MentorHttpError {
  status: number;
  body: MentorErrorBody;
}

export function mentorError(code: MentorErrorCode, extra: Omit<MentorErrorBody, "error"> = {}): MentorHttpError {
  const body: MentorErrorBody = { error: code, ...extra };
  if ((code === "credits_required" || code === "credits_exhausted") && !body.packages_url) body.packages_url = MENTOR_PACKAGES_URL;
  return { status: MENTOR_ERROR_STATUS[code], body };
}

// ─── Gate 2 + 3: feature switches ───────────────────────────────────────

export type FlagFn = (key: string, userId: string) => Promise<boolean>;

/** AI master, mentor master, beta allowlist, DB flag (60 s cache). Fails closed on a flag error. */
export async function checkMentorAccess(config: MentorConfig, userId: string, flag: FlagFn): Promise<MentorHttpError | null> {
  if (!config.aiFeaturesEnabled) return mentorError("ai_disabled");
  if (!config.enabled) return mentorError("mentor_disabled");
  if (config.betaUserIds.length > 0 && !config.betaUserIds.includes(userId.toLowerCase())) return mentorError("mentor_disabled");
  let on = false;
  try {
    on = await flag(MENTOR_DB_FLAG_KEY, userId);
  } catch {
    on = false;
  }
  return on ? null : mentorError("mentor_disabled");
}

// ─── Gate 4: input ──────────────────────────────────────────────────────

export type ParsedChat = { ok: true; request: MentorChatRequest } | { ok: false; error: MentorHttpError };

/** Validates a chat body. The message is trimmed; nothing from it ever reaches the system prompt. */
export function parseChatRequest(raw: unknown): ParsedChat {
  const bad = (code: MentorErrorCode = "invalid_input"): ParsedChat => ({ ok: false, error: mentorError(code) });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad();
  const b = raw as Record<string, unknown>;
  if (typeof b.message !== "string") return bad();
  const message = b.message.trim();
  if (message.length === 0) return bad();
  if (message.length > MENTOR_MESSAGE_MAX_CHARS) return bad("input_too_large");
  if (typeof b.lang !== "string" || !(MENTOR_LANGS as readonly string[]).includes(b.lang)) return bad();
  if (typeof b.mode !== "string" || !(MENTOR_MODES as readonly string[]).includes(b.mode)) return bad();
  const request: MentorChatRequest = { message, lang: b.lang as MentorChatRequest["lang"], mode: b.mode as MentorChatRequest["mode"] };
  if (b.conversation_id !== undefined && b.conversation_id !== null) {
    if (typeof b.conversation_id !== "string" || !UUID_RE.test(b.conversation_id)) return bad();
    request.conversation_id = b.conversation_id.toLowerCase();
  }
  if (b.question_id !== undefined && b.question_id !== null) {
    if (typeof b.question_id !== "number" || !Number.isSafeInteger(b.question_id) || b.question_id <= 0 || b.question_id > 2_147_483_647) {
      return bad();
    }
    request.question_id = b.question_id;
  }
  return { ok: true, request };
}

// ─── Gate 5: attempt rate limit ─────────────────────────────────────────

/** Seconds until the next Europe/Vienna midnight (at least 1). */
export function secondsUntilViennaMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const elapsed = get("hour") * 3600 + get("minute") * 60 + get("second");
  return Math.max(1, 86_400 - elapsed);
}

/** Seconds until the next UTC minute (the SQL minute window is date_trunc('minute', now())). */
export function secondsUntilNextMinute(now: Date): number {
  return Math.max(1, 60 - now.getUTCSeconds());
}

/** One attempt per user message, counted before any model call (attempts, not successes). */
export async function takeMentorAttempt(client: RpcClient, config: MentorConfig, userId: string, now: Date): Promise<MentorHttpError | null> {
  const r = await rpcAttemptTake(client, userId, config.ratePerMin, config.ratePerDay);
  if (r.ok) return null;
  if (r.reason === "rate_limited_day") return mentorError("rate_limited", { retry_after_seconds: secondsUntilViennaMidnight(now) });
  if (r.reason === "rate_limited_minute") return mentorError("rate_limited", { retry_after_seconds: secondsUntilNextMinute(now) });
  return mentorError("reserve_failed");
}

// ─── Gate 6: global breaker ─────────────────────────────────────────────

/**
 * ai_spend_month (UTC month: mentor ledger + legacy Anthropic rows) against
 * ai_spend_cap(floor, pct) with the C5 config numbers. At or over the cap the
 * mentor rests (503 global_cap); a DB error is 503 reserve_failed.
 */
export async function checkMentorBreaker(client: RpcClient, config: MentorConfig, now: Date): Promise<MentorHttpError | null> {
  const r = await checkGlobalSpend(client, { now, floorMicro: config.globalMonthlyCapFloorMicro, netPct: config.globalCapNetPct });
  if (r.ok) return null;
  return r.reason === "global_cap" ? mentorError("global_cap") : mentorError("reserve_failed");
}

/** Read-only breaker state for the usage view: true (resting), false, or null when unknown. */
export async function mentorResting(client: RpcClient, config: MentorConfig, now: Date): Promise<boolean | null> {
  const r = await checkGlobalSpend(client, { now, floorMicro: config.globalMonthlyCapFloorMicro, netPct: config.globalCapNetPct });
  if (r.ok) return false;
  return r.reason === "global_cap" ? true : null;
}

/** Breaker state for the usage view, cached per instance (review M5). */
export type RestingFn = (client: RpcClient, config: MentorConfig, now: Date) => Promise<boolean | null>;

/**
 * mentorResting with a TTL cache: the usage view is polled on every page, and
 * each uncached call runs the month spend scans. Only a known answer (true or
 * false) is cached; an unknown (null, DB error) is retried on the next call.
 * The chat route never uses this: it checks the live breaker on every message.
 */
export function createRestingCache(ttlMs = 60_000, nowMs: () => number = () => Date.now()): RestingFn {
  let hit: { at: number; key: string; value: boolean } | null = null;
  return async (client, config, now) => {
    const key = `${config.globalMonthlyCapFloorMicro}:${config.globalCapNetPct}`;
    const t = nowMs();
    if (hit && hit.key === key && t - hit.at < ttlMs) return hit.value;
    const value = await mentorResting(client, config, now);
    if (value !== null) hit = { at: t, key, value };
    return value;
  };
}

// ─── Services from the other mentor lanes (R3 wiring point) ─────────────

export interface MentorServices {
  brain: Brain;
  facts: FactsLoader;
  wallet: Wallet;
}

/**
 * THE single wiring point for the services other lanes implement:
 *   Brain, FactsLoader  W2-BRAIN   (src/lib/mentor/prompt|tools|validator.ts, facts-loader.ts)
 *   Wallet              W2-CREDITS (src/lib/mentor/credits/wallet.ts)
 * Wired at R3 (int/R3-20261010). The brain is a per-process singleton: it
 * keeps a turn store that bridges runTool and validate within one turn, so
 * every request must reuse the same instance (W2-BRAIN note 5). The facts
 * loader is already a singleton. The wallet is stateless and bound to the
 * route's service client. Never a no-op wallet, never the in-memory test meter.
 */
let brainSingleton: MentorBrain | null = null;

export function resolveMentorServices(client: SupabaseClient): MentorServices | null {
  const facts = getMentorFactsLoader();
  if (!brainSingleton) brainSingleton = createMentorBrain({ facts });
  return { brain: brainSingleton, facts, wallet: createWallet(client) };
}
