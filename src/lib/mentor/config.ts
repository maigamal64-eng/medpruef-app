/**
 * Mentor flags and metering config (contract C5, revised for the CREDITS
 * model, frozen by W0-C0B-MENTOR on 2026-10-10).
 *
 * Pure module: no I/O. Every boolean defaults OFF and reads as
 * `(env ?? "false") === "true"`, so a typo or a missing var can never turn
 * anything on. No flag turns metering off.
 *
 * Runtime gate (implemented by W2-CORE in src/lib/mentor/guard.ts):
 *   AI_FEATURES_ENABLED && MENTOR_ENABLED && flag("mentor", userId)
 *   && userId admitted (src/lib/mentor/access.ts): allowlisted
 *      (ai_mentor_beta_override row, else MENTOR_BETA_USER_IDS; an empty list
 *      admits nobody), or widened by MENTOR_ACCESS_SCOPE (paid | signed_in;
 *      default beta = allowlist only)
 *   && wallet available >= one reserve ceiling.
 * Buying packages additionally needs MENTOR_PACKAGES_ENABLED (and
 * MENTOR_TOPUPS_ENABLED for the one-time top-up).
 *
 * Money numbers that change with [name]'s pricing answer (credits per package,
 * prices, expiry, included grants) are NOT here: they are data rows in
 * public.ai_credit_package (migration 20261022100000_mentor_ledger.sql).
 * This file owns only the display unit, the safety numbers and which env var
 * holds each package's Whop plan id.
 */

import { MODEL_IDS } from "@/lib/ai/pricing";
import { MENTOR_CAP_SHARE_PCT_DEFAULT } from "@/lib/ai/limits";
import { parseMentorAccessScope, type MentorAccessScope } from "./access";

type Env = Record<string, string | undefined>;

/** 1 credit = 5,000 micro-USD (USD 0.005) of true API cost. Display only. */
export const CREDIT_MICRO_USD = 5_000;

/** The DB flag key read through src/lib/admin/flags.ts (60 s cache). */
export const MENTOR_DB_FLAG_KEY = "mentor";

/** Stale reservations older than this are settled at the ceiling (SQL uses 15 minutes too). */
export const RESERVE_STALE_MINUTES = 15;

/** History window sent to the model (turns, user + assistant). */
export const MENTOR_HISTORY_TURNS = 6;

/** Retrieval budget per call (tokens, approximated as UTF-8 bytes by the brain). */
export const MENTOR_RETRIEVAL_MAX_TOKENS = 4_000;

/** "low" state when fewer than this many credits are left. */
export const MENTOR_LOW_CREDITS = 10;
/** Descending balance crosses the higher limit first: under 15% OR under 10. */
export function mentorLowThreshold(currentGrantCredits: number): number {
  return Math.max(MENTOR_LOW_CREDITS, Number.isFinite(currentGrantCredits) ? Math.max(0,currentGrantCredits) * 0.15 : 0);
}

/**
 * Package id -> env var holding its Whop plan id. An unset or empty env var
 * means the package cannot be bought (the package API hides it). Pricing A
 * (2026-10-11): Basis EUR 4.90 / 150 credits, Plus EUR 9.90 / 400 credits,
 * top-up EUR 10 / 400 credits (rows in the ledger migration). The plan ids are
 * MISSING: they do not exist until [name] creates the "MedPrüf Mentor" product
 * on Whop; main-Claude then sets these vars. Never put an invented id here.
 */
export const MENTOR_WHOP_PLAN_ENV = Object.freeze({
  mentor_basis: "WHOP_PLAN_MENTOR_BASIS",
  mentor_plus: "WHOP_PLAN_MENTOR_PLUS",
  mentor_topup: "WHOP_PLAN_MENTOR_TOPUP",
} as const);

export type MentorSoldPackageId = keyof typeof MENTOR_WHOP_PLAN_ENV;

export interface MentorConfig {
  aiFeaturesEnabled: boolean;
  enabled: boolean;
  freeEnabled: boolean;
  escalationEnabled: boolean;
  packagesEnabled: boolean;
  topupsEnabled: boolean;
  telegramEnabled: boolean;
  betaUserIds: readonly string[];
  /** MENTOR_ACCESS_SCOPE: beta (default) | paid | signed_in. Scope-admitted accounts spend only lots they hold. */
  accessScope: MentorAccessScope;
  modelDefault: string;
  modelEscalate: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  maxToolRounds: number;
  ratePerMin: number;
  ratePerDay: number;
  houseFreeFailsPerDay: number;
  globalMonthlyCapFloorMicro: number;
  globalCapNetPct: number;
  /** MUX-106 A: percent of the monthly AI cap reserved for the mentor; legacy AI gets the rest. */
  mentorCapSharePct: number;
  /**
   * TTL of the fact-sheet cache breakpoint (a-anthropic-features). "5m"
   * (default) keeps every reserve ceiling and the admission bar exactly as
   * before. "1h" keeps the prefix warm across learners for an hour but prices
   * that prefix at the 1-hour write rate (2x instead of 1.25x input) in the
   * reserve, which raises admit_min_credits; [name] decides (release note).
   */
  factsCacheTtl: "5m" | "1h";
  /**
   * 5-minute breakpoint on the conversation tail of every call, so the next
   * tool round reads history and tool results from cache. Only the literal
   * "true" turns it on (default off until a live probe proves the request
   * shape on the production key: scripts/ai-probe.mjs).
   */
  tailCache: boolean;
  /**
   * MENTOR_RULINGS_NOTICES (a-mentor-fix-rulings, CEO rulings of 17 Oct), default off: the code-owned
   * learner lines of those rulings. On: a medical concept refusal (UC13) gets the practice line and the
   * question-bank pointer instead of the office line and link, and an answer for a learner who writes
   * in Arabic starts with the English notice line (mentor-arabic-notice). Neither changes a charge.
   * Optional so older test configs stay valid; absent reads as off.
   */
  rulingsNotices?: boolean;
}

export const MENTOR_CONFIG_DEFAULTS: Readonly<MentorConfig> = Object.freeze({
  aiFeaturesEnabled: false,
  enabled: false,
  freeEnabled: false,
  escalationEnabled: false,
  packagesEnabled: false,
  topupsEnabled: false,
  telegramEnabled: false,
  betaUserIds: Object.freeze([]) as readonly string[],
  accessScope: "beta",
  modelDefault: MODEL_IDS.HAIKU_5_5,
  modelEscalate: MODEL_IDS.SONNET_5_5,
  effort: "low",
  // Haiku 5.5 always thinks (300 to 600 output tokens even at effort low), so 700
  // cut the visible answer off (eval round 1: 9 truncated or empty answers) and
  // 1000 still cut long German deadline answers (eval round 3: successful ones
  // use 924 to 973; 5 cut-offs in 2 full runs). 1500 leaves room; a cut-off
  // answer is retried once (turn.ts).
  //
  // Cost basis (Haiku 5.5, pricing.ts reserveCeilingMicro, 2026-10-11): one
  // call reserves (input bytes + 512) x USD 0.125/MTok (cache write, the dearest
  // input rate) + max_tokens x USD 0.50/MTok. Real first call of a German
  // deadline question (about 50 KB of prompt): USD 0.0068 at 1000, 0.0070 at
  // 1500, 0.0073 at 2000 (1.35 / 1.40 / 1.45 credits). Admission needs 3 such
  // ceilings, so the last 4.2 credits of a balance cannot start a message
  // (4.06 at 1000). Every call is reserved at its ceiling before it runs and
  // holds stay open until the turn ends, so a turn (3 rounds plus one retry,
  // about USD 0.028 at worst) can never spend more than the wallet held; a
  // retry or a later round that does not fit ends the turn on the house.
  // Measured actual cost (eval run2-r3 at 1000, warm cache, 150 messages):
  // mean USD 0.0007, p95 0.0011, max 0.0014 per message at about 1.5 calls,
  // so one credit (USD 0.005) still covers a typical message several times
  // over and "about one message per credit" stays a conservative promise.
  // A failed or notice-only turn costs the learner 0 (turn.ts).
  maxTokens: 1500,
  maxToolRounds: 3,
  ratePerMin: 6,
  ratePerDay: 60,
  houseFreeFailsPerDay: 3,
  globalMonthlyCapFloorMicro: 50_000_000,
  globalCapNetPct: 6,
  mentorCapSharePct: MENTOR_CAP_SHARE_PCT_DEFAULT,
  factsCacheTtl: "5m",
  tailCache: false,
  rulingsNotices: false,
});

export const MENTOR_ENV = Object.freeze({
  aiFeaturesEnabled: "AI_FEATURES_ENABLED",
  enabled: "MENTOR_ENABLED",
  freeEnabled: "MENTOR_FREE_ENABLED",
  escalationEnabled: "MENTOR_ESCALATION_ENABLED",
  packagesEnabled: "MENTOR_PACKAGES_ENABLED",
  topupsEnabled: "MENTOR_TOPUPS_ENABLED",
  telegramEnabled: "MENTOR_TELEGRAM_ENABLED",
  betaUserIds: "MENTOR_BETA_USER_IDS",
  accessScope: "MENTOR_ACCESS_SCOPE",
  modelDefault: "MENTOR_MODEL_DEFAULT",
  modelEscalate: "MENTOR_MODEL_ESCALATE",
  effort: "MENTOR_EFFORT",
  maxTokens: "MENTOR_MAX_TOKENS",
  maxToolRounds: "MENTOR_MAX_TOOL_ROUNDS",
  ratePerMin: "MENTOR_RATE_PER_MIN",
  ratePerDay: "MENTOR_RATE_PER_DAY",
  houseFreeFailsPerDay: "MENTOR_HOUSE_FREE_FAILS_PER_DAY",
  globalMonthlyCapFloorMicro: "MENTOR_GLOBAL_MONTHLY_CAP_FLOOR_MICRO",
  globalCapNetPct: "MENTOR_GLOBAL_CAP_NET_PCT",
  mentorCapSharePct: "MENTOR_CAP_SHARE_PCT",
  factsCacheTtl: "MENTOR_FACTS_CACHE_TTL",
  tailCache: "MENTOR_TAIL_CACHE",
  rulingsNotices: "MENTOR_RULINGS_NOTICES",
} as const);

/** Strict boolean: only the literal "true" is on. */
export function envFlag(raw: string | undefined): boolean {
  return (raw ?? "false").trim() === "true";
}

/** Integer in [min, max]; anything else falls back. */
export function envInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function envEffort(raw: string | undefined): MentorConfig["effort"] {
  const v = (raw ?? "").trim();
  return v === "low" || v === "medium" || v === "high" ? v : MENTOR_CONFIG_DEFAULTS.effort;
}

function envModel(raw: string | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  return v === "" ? fallback : v;
}

export function parseBetaUserIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s));
}

export function readMentorConfig(env: Env = process.env): MentorConfig {
  const d = MENTOR_CONFIG_DEFAULTS;
  return {
    aiFeaturesEnabled: envFlag(env[MENTOR_ENV.aiFeaturesEnabled]),
    enabled: envFlag(env[MENTOR_ENV.enabled]),
    freeEnabled: envFlag(env[MENTOR_ENV.freeEnabled]),
    escalationEnabled: envFlag(env[MENTOR_ENV.escalationEnabled]),
    packagesEnabled: envFlag(env[MENTOR_ENV.packagesEnabled]),
    topupsEnabled: envFlag(env[MENTOR_ENV.topupsEnabled]),
    telegramEnabled: envFlag(env[MENTOR_ENV.telegramEnabled]),
    betaUserIds: Object.freeze(parseBetaUserIds(env[MENTOR_ENV.betaUserIds])),
    accessScope: parseMentorAccessScope(env[MENTOR_ENV.accessScope]),
    modelDefault: envModel(env[MENTOR_ENV.modelDefault], d.modelDefault),
    modelEscalate: envModel(env[MENTOR_ENV.modelEscalate], d.modelEscalate),
    effort: envEffort(env[MENTOR_ENV.effort]),
    // Hard ceilings: env can only tighten these, never exceed the contract.
    maxTokens: envInt(env[MENTOR_ENV.maxTokens], d.maxTokens, 64, 2000),
    maxToolRounds: envInt(env[MENTOR_ENV.maxToolRounds], d.maxToolRounds, 1, 3),
    ratePerMin: envInt(env[MENTOR_ENV.ratePerMin], d.ratePerMin, 0, 60),
    ratePerDay: envInt(env[MENTOR_ENV.ratePerDay], d.ratePerDay, 0, 1000),
    houseFreeFailsPerDay: envInt(env[MENTOR_ENV.houseFreeFailsPerDay], d.houseFreeFailsPerDay, 0, 20),
    globalMonthlyCapFloorMicro: envInt(env[MENTOR_ENV.globalMonthlyCapFloorMicro], d.globalMonthlyCapFloorMicro, 0, 1_000_000_000),
    globalCapNetPct: envInt(env[MENTOR_ENV.globalCapNetPct], d.globalCapNetPct, 0, 100),
    mentorCapSharePct: envInt(env[MENTOR_ENV.mentorCapSharePct], d.mentorCapSharePct, 0, 100),
    factsCacheTtl: (env[MENTOR_ENV.factsCacheTtl] ?? "").trim() === "1h" ? "1h" : "5m",
    tailCache: envFlag(env[MENTOR_ENV.tailCache]),
    rulingsNotices: envFlag(env[MENTOR_ENV.rulingsNotices]),
  };
}

/** Whop plan id for a sold package, or null when the env var is unset. */
export function mentorWhopPlanId(pkg: MentorSoldPackageId, env: Env = process.env): string | null {
  const v = env[MENTOR_WHOP_PLAN_ENV[pkg]]?.trim();
  return v ? v : null;
}

/** Reverse map: which sold package does this Whop plan id belong to? */
export function mentorPackageForWhopPlan(planId: string | null | undefined, env: Env = process.env): MentorSoldPackageId | null {
  const id = planId?.trim();
  if (!id) return null;
  for (const pkg of Object.keys(MENTOR_WHOP_PLAN_ENV) as MentorSoldPackageId[]) {
    if (mentorWhopPlanId(pkg, env) === id) return pkg;
  }
  return null;
}

/** Exact wallet/ledger credits for verifiable balances and debit receipts. */
export function creditsExactFromMicro(micro: number): number {
  return Number.isFinite(micro) && micro > 0 ? micro / CREDIT_MICRO_USD : 0;
}

/** Whole credits a learner may see (floor; never negative). */
export function creditsFromMicro(micro: number): number {
  if (!Number.isFinite(micro) || micro <= 0) return 0;
  return Math.floor(micro / CREDIT_MICRO_USD);
}

/**
 * "About N messages left": available balance divided by the user's rolling
 * average settled cost per message. Without history, one credit is assumed
 * to cover one message (a conservative planning cost of USD 0.005).
 */
export function messagesLeftEstimate(availableMicro: number, avgMessageCostMicro: number | null): number {
  if (!Number.isFinite(availableMicro) || availableMicro <= 0) return 0;
  const per = avgMessageCostMicro && avgMessageCostMicro > 0 ? avgMessageCostMicro : CREDIT_MICRO_USD;
  return Math.floor(availableMicro / per);
}

/**
 * Admission rule (frozen; W2-CORE guard): a user message starts only when
 * available >= maxToolRounds x the FIRST call's reserve ceiling. Reserves are
 * per call, so without this a user could pay for round 1 and then fail the
 * round-2 reserve mid-answer. Below the bar: 402 credits_exhausted (or
 * credits_required when the user never had a lot). Later rounds still
 * reserve individually; a later reserve failure ends the turn with an
 * `error` event and only the calls actually made are charged.
 */
export function admitMessageMinMicro(firstCallCeilingMicro: number, maxToolRounds: number): number {
  if (!Number.isInteger(firstCallCeilingMicro) || firstCallCeilingMicro <= 0) throw new RangeError("invalid ceiling");
  if (!Number.isInteger(maxToolRounds) || maxToolRounds < 1) throw new RangeError("invalid rounds");
  return firstCallCeilingMicro * maxToolRounds;
}

export function canAdmitMessage(availableMicro: number, firstCallCeilingMicro: number, maxToolRounds: number): boolean {
  return Number.isFinite(availableMicro) && availableMicro >= admitMessageMinMicro(firstCallCeilingMicro, maxToolRounds);
}
