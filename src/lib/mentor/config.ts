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
 *   && (MENTOR_BETA_USER_IDS empty || userId in it)
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
export const MENTOR_LOW_CREDITS = 20;

/**
 * Package id -> env var holding its Whop plan id. An unset or empty env var
 * means the package cannot be bought (the package API hides it). The plan
 * ids do not exist yet: [name] creates the plans (separate Whop product
 * recommended) and main-Claude sets these vars.
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
  betaUserIds: readonly string[];
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
}

export const MENTOR_CONFIG_DEFAULTS: Readonly<MentorConfig> = Object.freeze({
  aiFeaturesEnabled: false,
  enabled: false,
  freeEnabled: false,
  escalationEnabled: false,
  packagesEnabled: false,
  topupsEnabled: false,
  betaUserIds: Object.freeze([]) as readonly string[],
  modelDefault: MODEL_IDS.HAIKU_5_5,
  modelEscalate: MODEL_IDS.SONNET_5_5,
  effort: "low",
  maxTokens: 700,
  maxToolRounds: 3,
  ratePerMin: 6,
  ratePerDay: 60,
  houseFreeFailsPerDay: 3,
  globalMonthlyCapFloorMicro: 50_000_000,
  globalCapNetPct: 6,
});

export const MENTOR_ENV = Object.freeze({
  aiFeaturesEnabled: "AI_FEATURES_ENABLED",
  enabled: "MENTOR_ENABLED",
  freeEnabled: "MENTOR_FREE_ENABLED",
  escalationEnabled: "MENTOR_ESCALATION_ENABLED",
  packagesEnabled: "MENTOR_PACKAGES_ENABLED",
  topupsEnabled: "MENTOR_TOPUPS_ENABLED",
  betaUserIds: "MENTOR_BETA_USER_IDS",
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
    betaUserIds: Object.freeze(parseBetaUserIds(env[MENTOR_ENV.betaUserIds])),
    modelDefault: envModel(env[MENTOR_ENV.modelDefault], d.modelDefault),
    modelEscalate: envModel(env[MENTOR_ENV.modelEscalate], d.modelEscalate),
    effort: envEffort(env[MENTOR_ENV.effort]),
    // Hard ceilings: env can only tighten these, never exceed the contract.
    maxTokens: envInt(env[MENTOR_ENV.maxTokens], d.maxTokens, 64, 700),
    maxToolRounds: envInt(env[MENTOR_ENV.maxToolRounds], d.maxToolRounds, 1, 3),
    ratePerMin: envInt(env[MENTOR_ENV.ratePerMin], d.ratePerMin, 0, 60),
    ratePerDay: envInt(env[MENTOR_ENV.ratePerDay], d.ratePerDay, 0, 1000),
    houseFreeFailsPerDay: envInt(env[MENTOR_ENV.houseFreeFailsPerDay], d.houseFreeFailsPerDay, 0, 20),
    globalMonthlyCapFloorMicro: envInt(env[MENTOR_ENV.globalMonthlyCapFloorMicro], d.globalMonthlyCapFloorMicro, 0, 1_000_000_000),
    globalCapNetPct: envInt(env[MENTOR_ENV.globalCapNetPct], d.globalCapNetPct, 0, 100),
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
