/**
 * Mentor admin cost view: the I/O half (W3-COSTVIEW). READ-ONLY.
 *
 * Plain selects only (eq, in, gte, lt, order, range). No jsonb filters, no
 * writes, no new SQL: the migration belongs to the contract owner, so every
 * aggregate is computed in TypeScript (aggregate.ts).
 *
 * PostgREST clips one response at about 1,000 rows no matter what limit is
 * asked for, so the ledger and lot reads page with .range() in a stable
 * order. If the hard page cap is reached the load FAILS (row_cap_reached)
 * instead of returning a short total that would look like real data.
 *
 * Failure modes are typed, never zeros:
 *   ledger_not_applied  the mentor tables do not exist yet (migration
 *                       20261022100000 is unapplied until release train R3)
 *   row_cap_reached     more rows than the page cap
 *   db_error            anything else (including the spend/cap RPCs)
 */

import type { MentorTurnRow } from "@/lib/mentor/outcomes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkGlobalSpend, type RpcClient } from "@/lib/ai/limits";
import { mentorSpendCheck } from "@/lib/mentor/guard";
import { MENTOR_DB_FLAG_KEY, RESERVE_STALE_MINUTES, type MentorConfig } from "@/lib/mentor/config";
import {
  CLAWBACKS_LIMIT,
  STALE_RESERVATIONS_LIMIT,
  type ClawbackRow,
  type DbFlagRow,
  type LedgerCallRow,
  type LotRow,
  type StaleReservationRow,
  type SummaryInputs,
} from "./aggregate";

export const PAGE_SIZE = 1_000;
/** 200 pages x 1,000 rows. Above this the view refuses rather than undercount. */
export const MAX_PAGES = 200;

export type MentorAdminLoadErrorCode = "ledger_not_applied" | "row_cap_reached" | "db_error";

export class MentorAdminLoadError extends Error {
  readonly code: MentorAdminLoadErrorCode;
  constructor(code: MentorAdminLoadErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "MentorAdminLoadError";
    this.code = code;
  }
}

interface DbError {
  code?: string;
  message?: string;
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: DbError | null }>;

/** Postgres 42P01 / PostgREST PGRST205: the relation is not there (yet). */
export function isMissingRelation(err: DbError | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  return /relation .* does not exist|could not find the table/i.test(err.message ?? "");
}

function fail(err: DbError | null | undefined): never {
  if (isMissingRelation(err)) throw new MentorAdminLoadError("ledger_not_applied", err?.code);
  throw new MentorAdminLoadError("db_error", err?.code ?? err?.message);
}

/** Read every page of a query (stable order required). Fails over the cap. */
export async function fetchAllPages<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) fail(error);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return rows;
  }
  throw new MentorAdminLoadError("row_cap_reached", `more than ${MAX_PAGES * PAGE_SIZE} rows`);
}

/** [start, end) of the UTC month as ISO strings, for created_at filters. */
export function monthRangeIso(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new MentorAdminLoadError("db_error", "bad month");
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1)).toISOString(), end: new Date(Date.UTC(y, mo + 1, 1)).toISOString() };
}

export function utcMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Read everything the summary needs. `now` and `config` are arguments so the
 * route stays a thin shell and tests control the clock.
 */
export async function loadSummaryInputs(
  client: SupabaseClient,
  config: MentorConfig,
  now: Date,
): Promise<SummaryInputs> {
  const month = utcMonth(now);
  const { start, end } = monthRangeIso(month);
  const staleBefore = new Date(now.getTime() - RESERVE_STALE_MINUTES * 60_000).toISOString();

  const [ledger, lots, clawbacks, stale, debts, flag, turns] = await Promise.all([
    // Settled calls of the month: the spend, by-day, by-model and per-user source.
    fetchAllPages<LedgerCallRow>((from, to) =>
      client
        .from("ai_usage_ledger")
        .select("user_id, kind, cost_micro, hold_micro, request_id, model, input_tokens, output_tokens, cache_read_tokens, created_at")
        .in("kind", ["settle", "house_cost"])
        .gte("created_at", start)
        .lt("created_at", end)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PageResult<LedgerCallRow>,
    ),
    // Lifetime lots: sold vs consumed per package, live balance per user.
    fetchAllPages<LotRow>((from, to) =>
      client
        .from("ai_credit_lot")
        .select("user_id, package_id, status, granted_micro, spent_micro, clawed_back_micro, starts_at, expires_at")
        .order("id", { ascending: true })
        .range(from, to) as unknown as PageResult<LotRow>,
    ),
    // Latest clawbacks (refunds, disputes), newest first.
    (async (): Promise<ClawbackRow[]> => {
      const { data, error } = await client
        .from("ai_usage_ledger")
        .select("lot_id, user_id, package_id, delta_micro_usd, created_at")
        .eq("kind", "clawback")
        .order("id", { ascending: false })
        .limit(CLAWBACKS_LIMIT);
      if (error) fail(error);
      return (data ?? []) as ClawbackRow[];
    })(),
    // Stuck holds: open reservations older than the sweep threshold.
    (async (): Promise<StaleReservationRow[]> => {
      const { data, error } = await client
        .from("ai_mentor_reservation")
        .select("request_id, call_index, user_id, ceiling_micro, created_at")
        .eq("status", "open")
        .lt("created_at", staleBefore)
        .order("created_at", { ascending: true })
        .limit(STALE_RESERVATIONS_LIMIT);
      if (error) fail(error);
      return (data ?? []) as StaleReservationRow[];
    })(),
    // Wallets with debt (overrun or late settle not covered by a live lot).
    fetchAllPages<{ debt_micro: number }>((from, to) =>
      client
        .from("ai_credit_wallet")
        .select("debt_micro")
        .gt("debt_micro", 0)
        .order("user_id", { ascending: true })
        .range(from, to) as unknown as PageResult<{ debt_micro: number }>,
    ),
    // The DB flag row, read the same way src/lib/admin/flags.ts reads it.
    (async (): Promise<DbFlagRow | null> => {
      const { data, error } = await client
        .from("flags")
        .select("enabled, env, rollout_pct")
        .eq("key", MENTOR_DB_FLAG_KEY)
        .maybeSingle();
      if (error) fail(error);
      return (data as DbFlagRow | null) ?? null;
    })(),
    fetchAllPages<MentorTurnRow>((from, to) => client.from("ai_mentor_turn").select("*").gte("created_at", start).lt("created_at", end)
      .order("request_id", { ascending: true }).range(from, to) as unknown as PageResult<MentorTurnRow>),
  ]);

  // Spend and cap come from the SAME two RPCs the guard calls, so the admin
  // breaker status is exactly what the guard decides. An unknown result is an
  // error, never "not resting".
  const spend = await checkGlobalSpend(client as unknown as RpcClient, {
    now,
    floorMicro: config.globalMonthlyCapFloorMicro,
    netPct: config.globalCapNetPct,
  });
  if (spend.spentMicro === null || spend.capMicro === null || spend.reason === "db_error" || spend.reason === "bad_response") {
    throw new MentorAdminLoadError("db_error", spend.reason ?? "spend");
  }
  // MUX-106 A: is the split read installed? Then each lane has its own cap,
  // exactly as the guard decides (mentorSpendCheck). An unknown answer is an error.
  const lane = await mentorSpendCheck(client as unknown as RpcClient, config, now);
  if (lane.reason === "db_error" || lane.reason === "bad_response") throw new MentorAdminLoadError("db_error", "spend_split");

  return {
    month,
    now,
    turns,
    ledger,
    lots,
    clawbacks,
    staleReservations: stale,
    walletDebts: debts.map((d) => Number(d.debt_micro) || 0),
    dbFlag: flag,
    spendTotalMicro: spend.spentMicro,
    capMicro: spend.capMicro,
    config,
    splitCaps: lane.split,
  };
}
