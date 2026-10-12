/**
 * Legacy AI route limits and the DB quota/spend helpers (contract C5 legacy
 * half + C3a callers, frozen in wave 0).
 *
 * Every number is read from env AT CALL TIME (no module-level caching), so a
 * Vercel env change retunes limits without a code change. Defaults are the
 * contract values. Mentor limits live in src/lib/mentor/config.ts, not here.
 *
 * All DB helpers FAIL CLOSED: a DB error, a thrown client, or a response that
 * does not have the expected shape returns "not ok". They talk to the RPCs in
 * supabase/migrations/20261014095000_ai_quota_rpc.sql (unapplied until R2).
 *
 * Note for R2: the routes currently read AI_DAILY_QUOTA_PAID (chat) and
 * AI_TRANSLATE_QUOTA_PAID (translate). Those names go dead once the routes
 * switch to the names below; carry any intended prod value across.
 */

export type LegacyAiRoute = "ai_chat" | "translate" | "notes_transform";

export const LEGACY_AI_ROUTES: readonly LegacyAiRoute[] = ["ai_chat", "translate", "notes_transform"];

export interface LegacyAiLimits {
  chatDailyAttempts: number;
  translateDailyAttempts: number;
  transformDailyAttempts: number;
  /** Per-user cap on legacy AI spend per UTC calendar month, micro-USD. */
  userMonthlyCapMicro: number;
}

export const LEGACY_LIMIT_DEFAULTS: Readonly<LegacyAiLimits> = Object.freeze({
  chatDailyAttempts: 15,
  translateDailyAttempts: 40,
  transformDailyAttempts: 30,
  userMonthlyCapMicro: 3_000_000,
});

export const LEGACY_LIMIT_ENV = {
  chatDailyAttempts: "AI_CHAT_DAILY_ATTEMPTS",
  translateDailyAttempts: "AI_TRANSLATE_DAILY_ATTEMPTS",
  transformDailyAttempts: "AI_TRANSFORM_DAILY_ATTEMPTS",
  userMonthlyCapMicro: "AI_LEGACY_USER_MONTHLY_CAP_MICRO",
} as const;

/**
 * Parse a non-negative integer env value. Unset, blank, non-numeric,
 * negative or fractional values fall back to the default. "0" is honoured
 * (it means "nothing allowed"), which is the fail-safe reading.
 */
export function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return fallback;
  const v = Number(t);
  return Number.isSafeInteger(v) ? v : fallback;
}

type Env = Record<string, string | undefined>;

export function getLegacyAiLimits(env: Env = process.env): LegacyAiLimits {
  return {
    chatDailyAttempts: readNonNegativeInt(env[LEGACY_LIMIT_ENV.chatDailyAttempts], LEGACY_LIMIT_DEFAULTS.chatDailyAttempts),
    translateDailyAttempts: readNonNegativeInt(
      env[LEGACY_LIMIT_ENV.translateDailyAttempts],
      LEGACY_LIMIT_DEFAULTS.translateDailyAttempts,
    ),
    transformDailyAttempts: readNonNegativeInt(
      env[LEGACY_LIMIT_ENV.transformDailyAttempts],
      LEGACY_LIMIT_DEFAULTS.transformDailyAttempts,
    ),
    userMonthlyCapMicro: readNonNegativeInt(env[LEGACY_LIMIT_ENV.userMonthlyCapMicro], LEGACY_LIMIT_DEFAULTS.userMonthlyCapMicro),
  };
}

export function dailyAttemptLimit(route: LegacyAiRoute, limits: LegacyAiLimits = getLegacyAiLimits()): number {
  switch (route) {
    case "ai_chat":
      return limits.chatDailyAttempts;
    case "translate":
      return limits.translateDailyAttempts;
    case "notes_transform":
      return limits.transformDailyAttempts;
  }
}

// ─── DB helpers (fail closed) ───────────────────────────────────────────

/** The one method these helpers need from a Supabase client. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export type QuotaDenyReason = "limit_reached" | "invalid_args" | "db_error" | "bad_response";

export interface QuotaTakeResult {
  ok: boolean;
  /** Attempts counted for this user, route and Vienna day (null when unknown). */
  used: number | null;
  reason?: QuotaDenyReason;
}

const ROUTE_RE = /^[a-z][a-z0-9_]{0,39}$/;

function isCount(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
}

/** Interpret an ai_quota_take RPC reply. Anything unexpected is a denial. */
export function interpretQuotaTake(data: unknown, error: unknown): QuotaTakeResult {
  if (error) return { ok: false, used: null, reason: "db_error" };
  // PostgREST returns a jsonb scalar as the object itself; tolerate a
  // one-element array as well.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { ok: false, used: null, reason: "bad_response" };
  const r = row as { ok?: unknown; used?: unknown; reason?: unknown };
  const used = isCount(r.used) ? r.used : null;
  if (r.ok === true && used !== null) return { ok: true, used };
  if (r.ok === true) return { ok: false, used: null, reason: "bad_response" };
  const reason: QuotaDenyReason =
    r.reason === "limit_reached" || r.reason === "invalid_args" || r.reason === "db_error" ? r.reason : "bad_response";
  return { ok: false, used, reason };
}

/**
 * Atomically take one attempt for (user, route, Europe/Vienna day).
 * Call it BEFORE the model call; failed model calls still count (attempts).
 */
export async function takeAiQuota(client: RpcClient, userId: string, route: string, limit: number): Promise<QuotaTakeResult> {
  if (!userId || !ROUTE_RE.test(route) || !Number.isSafeInteger(limit)) {
    return { ok: false, used: null, reason: "invalid_args" };
  }
  if (limit < 1) return { ok: false, used: null, reason: "limit_reached" };
  try {
    const { data, error } = await client.rpc("ai_quota_take", { p_user: userId, p_route: route, p_limit: limit });
    return interpretQuotaTake(data, error);
  } catch {
    return { ok: false, used: null, reason: "db_error" };
  }
}

/** Parse a bigint-ish RPC scalar (PostgREST may send a number or a numeric string). */
export function parseMicro(data: unknown): number | null {
  const v = Array.isArray(data) ? data[0] : data;
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const nv = Number(v);
    return Number.isSafeInteger(nv) ? nv : null;
  }
  return null;
}

export interface LegacyCapCheck {
  ok: boolean;
  spentMicro: number | null;
  capMicro: number;
  reason?: "cap_reached" | "db_error" | "bad_response";
}

/**
 * Per-user legacy monthly cap: allowed only while this UTC month's legacy
 * spend is strictly below the cap.
 */
export async function checkLegacyUserCap(
  client: RpcClient,
  userId: string,
  limits: LegacyAiLimits = getLegacyAiLimits(),
): Promise<LegacyCapCheck> {
  const capMicro = limits.userMonthlyCapMicro;
  try {
    const { data, error } = await client.rpc("ai_legacy_cost_month", { p_user: userId });
    if (error) return { ok: false, spentMicro: null, capMicro, reason: "db_error" };
    const spent = parseMicro(data);
    if (spent === null) return { ok: false, spentMicro: null, capMicro, reason: "bad_response" };
    return spent < capMicro ? { ok: true, spentMicro: spent, capMicro } : { ok: false, spentMicro: spent, capMicro, reason: "cap_reached" };
  } catch {
    return { ok: false, spentMicro: null, capMicro, reason: "db_error" };
  }
}

/** "YYYY-MM" for the UTC calendar month containing `now`. */
export function utcMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface GlobalSpendCheck {
  ok: boolean;
  spentMicro: number | null;
  capMicro: number | null;
  reason?: "global_cap" | "db_error" | "bad_response";
}

/**
 * Global monthly Anthropic spend vs ai_spend_cap(). Allowed only while the
 * UTC month's spend is strictly below the cap. Floor and percent are passed
 * through so the mentor config (C5) stays the single owner of those numbers;
 * omitted, the SQL defaults (50,000,000 micro-USD and 6 percent) apply.
 */
export async function checkGlobalSpend(
  client: RpcClient,
  opts: { now?: Date; floorMicro?: number; netPct?: number } = {},
): Promise<GlobalSpendCheck> {
  try {
    const capArgs: Record<string, unknown> = {};
    if (opts.floorMicro !== undefined) capArgs.p_floor_micro = opts.floorMicro;
    if (opts.netPct !== undefined) capArgs.p_net_pct = opts.netPct;
    const [spentRes, capRes] = await Promise.all([
      client.rpc("ai_spend_month", { p_month: utcMonthKey(opts.now) }),
      client.rpc("ai_spend_cap", capArgs),
    ]);
    if (spentRes.error || capRes.error) return { ok: false, spentMicro: null, capMicro: null, reason: "db_error" };
    const spent = parseMicro(spentRes.data);
    const cap = parseMicro(capRes.data);
    if (spent === null || cap === null) return { ok: false, spentMicro: spent, capMicro: cap, reason: "bad_response" };
    return spent < cap ? { ok: true, spentMicro: spent, capMicro: cap } : { ok: false, spentMicro: spent, capMicro: cap, reason: "global_cap" };
  } catch {
    return { ok: false, spentMicro: null, capMicro: null, reason: "db_error" };
  }
}

// ─── Separate mentor and legacy caps (MUX-106 option A, 2026-10-12) ──────

export type SpendLane = "mentor" | "legacy";

/** Default share of the monthly AI cap reserved for the paid mentor; legacy gets the rest. */
export const MENTOR_CAP_SHARE_PCT_DEFAULT = 50;

/**
 * The total cap is split, never raised: the mentor gets floor(cap x share),
 * legacy AI (ai-chat, translate, notes transform, notes safety) the rest, so
 * the two lane caps always add up to the old shared ceiling.
 */
export function laneCapMicro(totalCapMicro: number, lane: SpendLane, mentorSharePct: number): number {
  const share = Math.min(100, Math.max(0, Math.floor(mentorSharePct)));
  const mentor = Math.floor((totalCapMicro * share) / 100);
  return lane === "mentor" ? mentor : totalCapMicro - mentor;
}

export interface LaneSpendCheck extends GlobalSpendCheck {
  lane: SpendLane;
  /** false: the split read is not installed yet and the shared total was checked (status quo). */
  split: boolean;
  totalSpentMicro: number | null;
  totalCapMicro: number | null;
}

function missingFunction(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (e.code === "PGRST202" || e.code === "42883") return true;
  return typeof e.message === "string" && /function public\.ai_spend_month_split\b[^\n]{0,80} does not exist|could not find the function/i.test(e.message);
}

function parseSplit(data: unknown): { mentor: number; legacy: number } | null {
  const v = Array.isArray(data) ? data[0] : data;
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const mentor = parseMicro(r.mentor_micro);
  const legacy = parseMicro(r.legacy_micro);
  return mentor === null || legacy === null ? null : { mentor, legacy };
}

/**
 * One lane's monthly spend against its own cap (ai_spend_month_split +
 * ai_spend_cap). A legacy surge can no longer rest the paid mentor, and the
 * mentor cannot starve legacy. Allowed only while the lane's spend is
 * strictly below its cap. Before the a38 changeset is applied the split read
 * is missing: the shared total is checked against the total cap, exactly as
 * before (never open). Any other DB problem fails closed.
 */
export async function checkLaneSpend(
  client: RpcClient,
  lane: SpendLane,
  opts: { now?: Date; floorMicro?: number; netPct?: number; mentorSharePct: number },
): Promise<LaneSpendCheck> {
  const unknown = (reason: "db_error" | "bad_response"): LaneSpendCheck => ({ ok: false, spentMicro: null, capMicro: null, reason, lane, split: true, totalSpentMicro: null, totalCapMicro: null });
  try {
    const capArgs: Record<string, unknown> = {};
    if (opts.floorMicro !== undefined) capArgs.p_floor_micro = opts.floorMicro;
    if (opts.netPct !== undefined) capArgs.p_net_pct = opts.netPct;
    const [splitRes, capRes] = await Promise.all([
      client.rpc("ai_spend_month_split", { p_month: utcMonthKey(opts.now) }),
      client.rpc("ai_spend_cap", capArgs),
    ]);
    if (splitRes.error && missingFunction(splitRes.error)) {
      const shared = await checkGlobalSpend(client, { now: opts.now, floorMicro: opts.floorMicro, netPct: opts.netPct });
      return { ...shared, lane, split: false, totalSpentMicro: shared.spentMicro, totalCapMicro: shared.capMicro };
    }
    if (splitRes.error || capRes.error) return unknown("db_error");
    const split = parseSplit(splitRes.data);
    const cap = parseMicro(capRes.data);
    if (!split || cap === null) return unknown("bad_response");
    const spent = lane === "mentor" ? split.mentor : split.legacy;
    const laneCap = laneCapMicro(cap, lane, opts.mentorSharePct);
    const base = { lane, split: true, totalSpentMicro: split.mentor + split.legacy, totalCapMicro: cap, spentMicro: spent, capMicro: laneCap };
    return spent < laneCap ? { ...base, ok: true } : { ...base, ok: false, reason: "global_cap" };
  } catch {
    return unknown("db_error");
  }
}
