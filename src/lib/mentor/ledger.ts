/**
 * Mentor ledger RPC layer (W2-CORE). Thin, typed calls over the C3 RPCs in
 * supabase/migrations/20261022100000_mentor_ledger.sql, plus pure
 * interpreters for their jsonb replies.
 *
 * Rules:
 *  - Nothing here throws. A transport error, a PostgREST error or a reply of
 *    an unexpected shape comes back as ok=false (fail closed).
 *  - The interpreters read the exact keys the SQL builds with
 *    jsonb_build_object (ok, reason, duplicate, remaining_micro,
 *    charged_micro, billed_to, overrun, ...). Tests feed them payloads
 *    captured from the real functions on a local Postgres.
 *  - Money is integer micro-USD.
 *
 * The Wallet (balance, grants) belongs to W2-CREDITS; this file never writes
 * credit lots.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RpcClient } from "@/lib/ai/limits";
import { MENTOR_RPCS, type MentorPackageId } from "./contract";
import type { MeterUsage, ReserveFailReason, ReserveResult, SettleResult } from "./seam";

export type { RpcClient };

// ─── Shape helpers ──────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** PostgREST returns a jsonb scalar as the object itself; tolerate a one-element array too. */
export function rpcRow(data: unknown): Row | null {
  const v = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
}

/** Integer micro-USD (may be negative for a balance in debt). PostgREST may send bigint as a string. */
export function intOrNull(x: unknown): number | null {
  if (typeof x === "number") return Number.isSafeInteger(x) ? x : null;
  if (typeof x === "string" && /^-?\d+$/.test(x)) {
    const n = Number(x);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

// ─── Interpreters (pure) ────────────────────────────────────────────────

const RESERVE_REASONS: ReadonlySet<string> = new Set(["insufficient", "invalid_args", "db_error"]);

/** mentor_reserve reply -> ReserveResult. */
export function interpretReserve(data: unknown, error: unknown): ReserveResult {
  if (error) return { ok: false, remainingMicro: null, reason: "db_error" };
  const r = rpcRow(data);
  if (!r) return { ok: false, remainingMicro: null, reason: "bad_response" };
  const remaining = intOrNull(r.remaining_micro);
  if (r.ok === true) {
    if (remaining === null) return { ok: false, remainingMicro: null, reason: "bad_response" };
    return r.duplicate === true ? { ok: true, duplicate: true, remainingMicro: remaining } : { ok: true, remainingMicro: remaining };
  }
  if (r.ok !== false) return { ok: false, remainingMicro: null, reason: "bad_response" };
  // A replay of a reservation that is already settled/released/swept.
  if (r.duplicate === true) return { ok: false, duplicate: true, remainingMicro: remaining, reason: "already_closed" };
  const reason: ReserveFailReason = typeof r.reason === "string" && RESERVE_REASONS.has(r.reason) ? (r.reason as ReserveFailReason) : "bad_response";
  return { ok: false, remainingMicro: remaining, reason };
}

/** mentor_settle reply -> SettleResult. */
export function interpretSettle(data: unknown, error: unknown): SettleResult {
  if (error) return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "db_error" };
  const r = rpcRow(data);
  if (!r) return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "bad_response" };
  if (r.ok === true) {
    const charged = intOrNull(r.charged_micro);
    if (r.duplicate === true) {
      // Already closed: no new debit, but retain its original payer for an exact receipt after a lost response.
      return { ok: true, duplicate: true, chargedMicro: charged, billedTo: r.billed_to === "user" || r.billed_to === "house" ? r.billed_to : null, overrun: false };
    }
    const billedTo = r.billed_to === "user" || r.billed_to === "house" ? r.billed_to : null;
    if (charged === null || charged < 0 || billedTo === null) {
      return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason: "bad_response" };
    }
    return { ok: true, chargedMicro: charged, billedTo, overrun: r.overrun === true };
  }
  const reason =
    r.reason === "not_found" || r.reason === "invalid_args" || r.reason === "db_error" ? r.reason : ("bad_response" as const);
  return { ok: false, chargedMicro: null, billedTo: null, overrun: false, reason };
}

/** Replies that only carry ok (mentor_settle_input, mentor_release). A closed release is ok (idempotent). */
export function interpretOk(data: unknown, error: unknown): { ok: boolean } {
  if (error) return { ok: false };
  const r = rpcRow(data);
  return { ok: r?.ok === true };
}

export type AttemptDenyReason = "rate_limited_minute" | "rate_limited_day" | "invalid_args" | "db_error" | "bad_response";

export interface AttemptResult {
  ok: boolean;
  reason?: AttemptDenyReason;
  minuteUsed: number | null;
  dayUsed: number | null;
}

/** mentor_attempt_take reply. Anything unexpected is a denial. */
export function interpretAttempt(data: unknown, error: unknown): AttemptResult {
  if (error) return { ok: false, reason: "db_error", minuteUsed: null, dayUsed: null };
  const r = rpcRow(data);
  if (!r) return { ok: false, reason: "bad_response", minuteUsed: null, dayUsed: null };
  const minuteUsed = intOrNull(r.minute_used);
  const dayUsed = intOrNull(r.day_used);
  if (r.ok === true) {
    return minuteUsed !== null && dayUsed !== null
      ? { ok: true, minuteUsed, dayUsed }
      : { ok: false, reason: "bad_response", minuteUsed: null, dayUsed: null };
  }
  const reason: AttemptDenyReason =
    r.reason === "rate_limited_minute" || r.reason === "rate_limited_day" || r.reason === "invalid_args" || r.reason === "db_error"
      ? r.reason
      : "bad_response";
  return { ok: false, reason, minuteUsed, dayUsed };
}

/** mentor_house_fail_take reply: true only when this failure is on the house. Fails closed (false). */
export function interpretHouseFail(data: unknown, error: unknown): boolean {
  if (error) return false;
  return rpcRow(data)?.ok === true;
}

/** mentor_sweep_stale reply. */
export function interpretSweep(data: unknown, error: unknown): { ok: boolean; settled: number | null } {
  if (error) return { ok: false, settled: null };
  const r = rpcRow(data);
  if (!r || r.ok !== true) return { ok: false, settled: null };
  const n = intOrNull(r.settled);
  return n === null || n < 0 ? { ok: false, settled: null } : { ok: true, settled: n };
}

// ─── Calls (never throw) ────────────────────────────────────────────────

async function call<T>(client: RpcClient, fn: string, args: Record<string, unknown>, interpret: (d: unknown, e: unknown) => T): Promise<T> {
  try {
    const { data, error } = await client.rpc(fn, args);
    return interpret(data, error);
  } catch (err) {
    return interpret(null, err ?? new Error("rpc threw"));
  }
}

const R = MENTOR_RPCS;

export function rpcReserve(client: RpcClient, userId: string, requestId: string, callIndex: number, ceilingMicro: number): Promise<ReserveResult> {
  return call(
    client,
    R.reserve.fn,
    { p_user: userId, p_request: requestId, p_call_index: callIndex, p_ceiling_micro: ceilingMicro },
    interpretReserve,
  );
}

export function rpcSettleInput(client: RpcClient, requestId: string, callIndex: number, inputMicro: number): Promise<{ ok: boolean }> {
  return call(client, R.settleInput.fn, { p_request: requestId, p_call_index: callIndex, p_input_micro: inputMicro }, interpretOk);
}

/** The usage jsonb the SQL reads (model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens). */
export function usageForLedger(usage: MeterUsage): Record<string, unknown> {
  return {
    model: usage.model ?? null,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export function rpcSettle(
  client: RpcClient,
  requestId: string,
  callIndex: number,
  actualMicro: number,
  usage: MeterUsage,
  billUser: boolean,
): Promise<SettleResult> {
  return call(
    client,
    R.settle.fn,
    { p_request: requestId, p_call_index: callIndex, p_actual_micro: actualMicro, p_usage: usageForLedger(usage), p_bill_user: billUser },
    interpretSettle,
  );
}

export function rpcRelease(client: RpcClient, requestId: string, callIndex: number): Promise<{ ok: boolean }> {
  return call(client, R.release.fn, { p_request: requestId, p_call_index: callIndex }, interpretOk);
}

export function rpcAttemptTake(client: RpcClient, userId: string, perMin: number, perDay: number): Promise<AttemptResult> {
  return call(client, R.attemptTake.fn, { p_user: userId, p_per_min: perMin, p_per_day: perDay }, interpretAttempt);
}

export function rpcHouseFailTake(client: RpcClient, userId: string, limit: number): Promise<boolean> {
  return call(client, R.houseFailTake.fn, { p_user: userId, p_limit: limit }, interpretHouseFail);
}

/** Settle every open reservation older than `minutes` at its ceiling, billed to its user. */
export function rpcSweepStale(client: RpcClient, minutes: number): Promise<{ ok: boolean; settled: number | null }> {
  if (!Number.isInteger(minutes) || minutes < 1) return Promise.resolve({ ok: false, settled: null });
  return call(client, R.sweepStale.fn, { p_older_than: `${minutes} minutes` }, interpretSweep);
}

// ─── Table reads for GET /api/mentor/usage (service role) ───────────────

const SOLD_PACKAGES: readonly MentorPackageId[] = ["mentor_basis", "mentor_plus", "mentor_topup"];

/** Active mentor Whop memberships of a user (renewing subscriptions). Throws on DB error. */
export async function readActiveMentorSubscriptions(client: SupabaseClient, userId: string): Promise<import("./contract").MentorUsageResponse["subscriptions"]> {
  const { data, error } = await client.from("ai_mentor_whop_membership").select("package_id,status,membership_id,renews_at,ends_at").eq("user_id", userId).eq("status", "active");
  if (error) throw new Error("ai_mentor_whop_membership read failed");
  if (!Array.isArray(data)) return [];
  const out: import("./contract").MentorUsageResponse["subscriptions"] = [];
  for (const row of data) {
    const pkg = (row as Row)?.package_id;
    if (typeof pkg === "string" && (SOLD_PACKAGES as readonly string[]).includes(pkg)) {
      out.push({ package_id: pkg as MentorPackageId, renews: pkg !== "mentor_topup", status: "active",
        renews_at: typeof row.renews_at === "string" ? row.renews_at : null,
        ends_at: typeof row.ends_at === "string" ? row.ends_at : null,
        ...(typeof row.membership_id === "string" ? { management_url: `https://whop.com/billing/manage/${encodeURIComponent(row.membership_id)}` } : {}),
      });
    }
  }
  return out;
}

/** Package ids whose ai_credit_package row is active. Throws on DB error. */
export async function readActivePackageIds(client: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await client.from("ai_credit_package").select("package_id,active").eq("active", true);
  if (error) throw new Error("ai_credit_package read failed");
  const ids = new Set<string>();
  if (Array.isArray(data)) for (const row of data) if (typeof (row as Row)?.package_id === "string") ids.add((row as Row).package_id as string);
  return ids;
}

/** Rate admission for an already reserved learner message. SQL rejects absent holds. */
export function rpcReservedAttempt(client: RpcClient, userId: string, requestId: string, perMin: number, perDay: number): Promise<ReturnType<typeof interpretAttempt>> {
  return call(client, "mentor_reserved_attempt", { p_user: userId, p_request: requestId, p_per_min: perMin, p_per_day: perDay }, interpretAttempt);
}
