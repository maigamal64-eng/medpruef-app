/**
 * Anthropic workspace spend meter (a-anthropic-features, 2026-10-14).
 *
 * ([name], 14 Oct: medpruef-prod USD 400, medpruef-dev USD 100), and a hard
 * stop would also stop paying learners. This meter watches the same money
 * from our own logs and acts first:
 *
 *   - month meter: UTC calendar month, cap = the workspace limit;
 *   - day meter:   UTC day, cap = month cap / days in the month (even burn),
 *                  so a runaway loop is caught within the day;
 *   - at 70 % of either: alarm (Sentry warning, Today card, hourly ops alert);
 *   - at 95 % of either: soft stop for free or house-funded calls (free
 *     translations, the notes safety scan, house-funded mentor turns); paid
 *     learners (isPaidAccess, or mentor lots they paid for) keep working.
 *
 * Spend = ai_call_log Anthropic rows (except route mentor) + mentor ledger
 * consumption (settle, house_cost), the same definition as ai_spend_month.
 * The database is shared by every deployment, so the meter counts all
 * logged spend against the cap of the workspace this deployment bills to:
 * in production that over-counts preview traffic (safe), in development the
 * dev cap is compared with production spend too (dev stops early, safe).
 *
 * An unreadable meter is "unknown" and does NOT stop calls: the existing
 * lane caps (checkLaneSpend) already fail closed on a database error, and
 * (globalMonthlyCapFloorMicro) still applies first until [name] raises it.
 */

type Env = Record<string, string | undefined>;

export type AiWorkspace = "prod" | "dev";
export type SpendState = "ok" | "alarm" | "soft_stop" | "unknown";
export type Funding = "paid" | "house";

export const WORKSPACE_CAP_USD: Readonly<Record<AiWorkspace, number>> = Object.freeze({ prod: 400, dev: 100 });
export const ALARM_PCT = 70;
export const SOFT_STOP_PCT = 95;
const MICRO = 1_000_000;

/** prod on the production deployment (VERCEL_ENV), dev everywhere else; AI_WORKSPACE overrides. */
export function aiWorkspace(env: Env = process.env): AiWorkspace {
  const o = (env.AI_WORKSPACE ?? "").trim();
  if (o === "prod" || o === "dev") return o;
  return env.VERCEL_ENV === "production" ? "prod" : "dev";
}

/** Monthly cap in micro-USD. AI_WORKSPACE_CAP_USD (positive number, at most 100,000) overrides the Console default. */
export function workspaceCapMicro(ws: AiWorkspace, env: Env = process.env): number {
  const raw = (env.AI_WORKSPACE_CAP_USD ?? "").trim();
  const n = raw === "" ? NaN : Number(raw);
  const usd = Number.isFinite(n) && n > 0 && n <= 100_000 ? n : WORKSPACE_CAP_USD[ws];
  return Math.round(usd * MICRO);
}

export function daysInUtcMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface SpendMeter {
  workspace: AiWorkspace;
  monthCapMicro: number;
  dayCapMicro: number;
  monthMicro: number | null;
  dayMicro: number | null;
  monthPct: number | null;
  dayPct: number | null;
  state: SpendState;
  /** Which meter drove the state ("month", "day", or null when ok/unknown). */
  trigger: "month" | "day" | null;
}

function pct(spent: number | null, cap: number): number | null {
  if (spent === null || cap <= 0) return null;
  return Math.floor((spent * 10_000) / cap) / 100;
}

/** Pure: the meter state from the two spends. */
export function evaluateSpend(input: { workspace: AiWorkspace; monthCapMicro: number; monthMicro: number | null; dayMicro: number | null; now: Date }): SpendMeter {
  const dayCapMicro = Math.floor(input.monthCapMicro / daysInUtcMonth(input.now));
  const monthPct = pct(input.monthMicro, input.monthCapMicro);
  const dayPct = pct(input.dayMicro, dayCapMicro);
  const base = { workspace: input.workspace, monthCapMicro: input.monthCapMicro, dayCapMicro, monthMicro: input.monthMicro, dayMicro: input.dayMicro, monthPct, dayPct };
  const over = (p: number | null, limit: number) => p !== null && p >= limit;
  if (over(monthPct, SOFT_STOP_PCT)) return { ...base, state: "soft_stop", trigger: "month" };
  if (over(dayPct, SOFT_STOP_PCT)) return { ...base, state: "soft_stop", trigger: "day" };
  if (over(monthPct, ALARM_PCT)) return { ...base, state: "alarm", trigger: "month" };
  if (over(dayPct, ALARM_PCT)) return { ...base, state: "alarm", trigger: "day" };
  if (monthPct === null || dayPct === null) return { ...base, state: "unknown", trigger: null };
  return { ...base, state: "ok", trigger: null };
}

/** Paid learners are never stopped by the meter; house-funded calls stop at 95 %. Unknown never stops. */
export function softStopBlocks(meter: Pick<SpendMeter, "state">, funding: Funding): boolean {
  return funding === "house" && meter.state === "soft_stop";
}

// ─── Reading the spend ───────────────────────────────────────────────────

type QueryResult = PromiseLike<{ data: unknown; error: unknown }>;

/** The slice of a Supabase client the meter reads. */
export interface SpendDb {
  rpc(fn: string, args?: Record<string, unknown>): QueryResult;
  from(table: string): {
    select(cols: string): {
      gte(col: string, v: string): {
        order(col: string, o: { ascending: boolean }): { range(from: number, to: number): QueryResult };
      };
    };
  };
}

const PAGE = 1000;
const MAX_PAGES = 50;

/**
 * A relation that is not installed (PostgreSQL 42P01, PostgREST PGRST205).
 * Only used for the mentor ledger: before its changeset there is no mentor
 * spend to count, so a missing table is 0, never "unknown".
 */
export function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

async function sumPages(db: SpendDb, table: string, cols: string, sinceIso: string, pick: (row: Record<string, unknown>) => number, missingIsZero = false): Promise<number | null> {
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .from(table)
      .select(cols)
      .gte("created_at", sinceIso)
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error && missingIsZero && isMissingRelation(error)) return 0;
    if (error || !Array.isArray(data)) return null;
    for (const r of data as Record<string, unknown>[]) total += pick(r);
    if (data.length < PAGE) return total;
  }
  return null; // more rows than the bound: unknown, never a low number
}

function usdToMicroCeil(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n * MICRO - 1e-6) : 0;
}

/** Logged Anthropic spend since the UTC day start, micro-USD, or null when unreadable. */
export async function readDaySpendMicro(db: SpendDb, now: Date): Promise<number | null> {
  const since = utcDayStart(now).toISOString();
  const [legacy, mentor] = await Promise.all([
    sumPages(db, "ai_call_log", "id, provider, route, cost_usd", since, (r) =>
      r.provider === "anthropic" && r.route !== "mentor" ? usdToMicroCeil(r.cost_usd) : 0,
    ),
    sumPages(db, "ai_usage_ledger", "id, kind, cost_micro", since, (r) =>
      (r.kind === "settle" || r.kind === "house_cost") && Number(r.cost_micro) > 0 ? Math.ceil(Number(r.cost_micro)) : 0,
      true,
    ),
  ]);
  return legacy === null || mentor === null ? null : legacy + mentor;
}

/** Logged Anthropic spend for the UTC month (ai_spend_month), micro-USD, or null. */
export async function readMonthSpendMicro(db: SpendDb, now: Date): Promise<number | null> {
  try {
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const { data, error } = await db.rpc("ai_spend_month", { p_month: month });
    if (error) return null;
    const n = typeof data === "number" ? data : typeof data === "string" ? Number(data) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

// ─── Per-instance cache + alarm ─────────────────────────────────────────

export const METER_TTL_MS = 60_000;
let cached: { at: number; key: string; meter: SpendMeter } | null = null;
let lastAlarm: { key: string; at: number } | null = null;
const ALARM_EVERY_MS = 60 * 60_000;

export function resetSpendMeterCacheForTests(): void {
  cached = null;
  lastAlarm = null;
}

export interface MeterOptions {
  now?: Date;
  env?: Env;
  /** Called at most once an hour per instance and state while the meter is at alarm or soft stop. */
  onAlarm?: (meter: SpendMeter) => void;
  /** Skip the per-instance cache (admin view). */
  fresh?: boolean;
}

/** The workspace meter, read at most once a minute per instance. Never throws. */
export async function workspaceSpendMeter(db: SpendDb, opts: MeterOptions = {}): Promise<SpendMeter> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const workspace = aiWorkspace(env);
  const monthCapMicro = workspaceCapMicro(workspace, env);
  const key = `${workspace}:${monthCapMicro}:${utcDayStart(now).toISOString()}`;
  const nowMs = now.getTime();
  let meter: SpendMeter;
  if (!opts.fresh && cached && cached.key === key && nowMs - cached.at < METER_TTL_MS && nowMs >= cached.at) {
    meter = cached.meter;
  } else {
    let monthMicro: number | null = null;
    let dayMicro: number | null = null;
    try {
      [monthMicro, dayMicro] = await Promise.all([readMonthSpendMicro(db, now), readDaySpendMicro(db, now)]);
    } catch {
      /* unknown */
    }
    meter = evaluateSpend({ workspace, monthCapMicro, monthMicro, dayMicro, now });
    cached = { at: nowMs, key, meter };
  }
  if ((meter.state === "alarm" || meter.state === "soft_stop") && opts.onAlarm) {
    const alarmKey = `${key}:${meter.state}`;
    if (!lastAlarm || lastAlarm.key !== alarmKey || nowMs - lastAlarm.at >= ALARM_EVERY_MS) {
      lastAlarm = { key: alarmKey, at: nowMs };
      try {
        opts.onAlarm(meter);
      } catch {
        /* an alarm sink never breaks a request */
      }
    }
  }
  return meter;
}

/** One line for logs and alerts (no learner data). */
export function describeMeter(m: SpendMeter): string {
  const usd = (micro: number | null) => (micro === null ? "unknown" : `USD ${(micro / MICRO).toFixed(2)}`);
  return `AI spend ${m.workspace}: month ${usd(m.monthMicro)} of USD ${(m.monthCapMicro / MICRO).toFixed(0)} (${m.monthPct ?? "?"} %), today ${usd(m.dayMicro)} of USD ${(m.dayCapMicro / MICRO).toFixed(2)} (${m.dayPct ?? "?"} %), state ${m.state}`;
}
