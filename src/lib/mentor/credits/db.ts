/**
 * Mentor credits: typed, fail-closed wrappers over the C3 ledger RPCs
 * (supabase/migrations/20261022100000_mentor_ledger.sql). W2-CREDITS owns
 * this file. Every money RPC returns jsonb with `ok`; transport errors and
 * unparseable bodies come back as ok=false with reason "db_error" /
 * "bad_response", never as an exception. mentor_whop_lookup and
 * mentor_balance raise on error in SQL, so their wrappers return a tagged
 * error instead of throwing.
 *
 * Only the service-role client may call these (EXECUTE is granted to
 * service_role only).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MENTOR_RPCS, MENTOR_PACKAGE_IDS, type CreditLotSource, type MentorPackageId } from "../contract";

export type RpcClient = Pick<SupabaseClient, "rpc">;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical uuid string (the ledger user_id columns are uuid). */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function isMentorPackageId(v: unknown): v is MentorPackageId {
  return typeof v === "string" && (MENTOR_PACKAGE_IDS as readonly string[]).includes(v);
}

function obj(v: unknown): Record<string, unknown> | null {
  // supabase-js returns the jsonb object directly; tolerate a one-row array too.
  if (Array.isArray(v)) v = v.length === 1 ? v[0] : null;
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** PostgREST / Postgres codes for "function or table does not exist" (migration not applied). */
const MISSING_OBJECT_CODES = new Set(["PGRST202", "42883", "42P01", "PGRST205"]);

export function isMissingObjectError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && MISSING_OBJECT_CODES.has(code);
}

// ─── mentor_grant_credits ───────────────────────────────────────────────

export interface GrantArgs {
  userId: string;
  packageId: MentorPackageId;
  source: CreditLotSource;
  sourceId: string;
  /** null: the package row's grant_micro. */
  micro?: number | null;
  startsAt?: Date | null;
  /** null: starts_at + package expiry_days. Included lots pass min(slice end, entitlement end). */
  expiresAt?: Date | null;
  whopPaymentId?: string | null;
  whopMembershipId?: string | null;
}

export type GrantReason =
  | "invalid_args"
  | "unknown_package"
  | "zero_grant"
  | "source_conflict"
  | "db_error"
  | "missing_function"
  | "bad_response";

export interface GrantOutcome {
  ok: boolean;
  duplicate: boolean;
  lotId: string | null;
  grantedMicro: number | null;
  reason?: GrantReason;
}

export async function rpcGrantCredits(sb: RpcClient, a: GrantArgs): Promise<GrantOutcome> {
  const fail = (reason: GrantReason, lotId: string | null = null): GrantOutcome => ({
    ok: false,
    duplicate: false,
    lotId,
    grantedMicro: null,
    reason,
  });
  // Validate before the RPC: a non-uuid user would fail the cast inside SQL
  // and come back as db_error, which the webhook maps to 503 (retry loop).
  if (!isUuid(a.userId) || !isMentorPackageId(a.packageId) || !a.sourceId || a.sourceId.length > 200) {
    return fail("invalid_args");
  }
  if (a.micro != null && (!Number.isInteger(a.micro) || a.micro <= 0)) return fail("invalid_args");
  if (a.startsAt && a.expiresAt && !(a.expiresAt.getTime() > a.startsAt.getTime())) return fail("invalid_args");

  const fn = MENTOR_RPCS.grantCredits.fn;
  try {
    const { data, error } = await sb.rpc(fn, {
      p_user: a.userId,
      p_package: a.packageId,
      p_source: a.source,
      p_source_id: a.sourceId,
      p_micro: a.micro ?? null,
      p_starts_at: a.startsAt ? a.startsAt.toISOString() : null,
      p_expires_at: a.expiresAt ? a.expiresAt.toISOString() : null,
      p_whop_payment_id: a.whopPaymentId ?? null,
      p_whop_membership_id: a.whopMembershipId ?? null,
    });
    if (error) return fail(isMissingObjectError(error) ? "missing_function" : "db_error");
    const o = obj(data);
    if (!o || typeof o.ok !== "boolean") return fail("bad_response");
    if (!o.ok) {
      const r = o.reason;
      const reason: GrantReason =
        r === "invalid_args" || r === "unknown_package" || r === "zero_grant" || r === "source_conflict" || r === "db_error"
          ? r
          : "bad_response";
      return fail(reason, strOrNull(o.lot_id));
    }
    return {
      ok: true,
      duplicate: o.duplicate === true,
      lotId: strOrNull(o.lot_id),
      grantedMicro: num(o.granted_micro),
    };
  } catch {
    return fail("db_error");
  }
}

// ─── mentor_clawback ────────────────────────────────────────────────────

export interface ClawbackOutcome {
  ok: boolean;
  duplicate: boolean;
  userId: string | null;
  clawedMicro: number | null;
  reason?: "invalid_args" | "not_found" | "db_error" | "missing_function" | "bad_response";
}

export async function rpcClawback(
  sb: RpcClient,
  source: CreditLotSource,
  sourceId: string,
  reasonNote: string,
): Promise<ClawbackOutcome> {
  const fail = (reason: NonNullable<ClawbackOutcome["reason"]>): ClawbackOutcome => ({
    ok: false,
    duplicate: false,
    userId: null,
    clawedMicro: null,
    reason,
  });
  if (!sourceId) return fail("invalid_args");
  try {
    const { data, error } = await sb.rpc(MENTOR_RPCS.clawback.fn, {
      p_source: source,
      p_source_id: sourceId,
      p_reason: reasonNote.slice(0, 200),
    });
    if (error) return fail(isMissingObjectError(error) ? "missing_function" : "db_error");
    const o = obj(data);
    if (!o || typeof o.ok !== "boolean") return fail("bad_response");
    if (!o.ok) {
      return fail(o.reason === "not_found" || o.reason === "invalid_args" || o.reason === "db_error" ? o.reason : "bad_response");
    }
    return { ok: true, duplicate: o.duplicate === true, userId: strOrNull(o.user_id), clawedMicro: num(o.clawed_micro) };
  } catch {
    return fail("db_error");
  }
}

// ─── mentor_membership_status ───────────────────────────────────────────

export interface MembershipStatusOutcome {
  ok: boolean;
  userId: string | null;
  reason?: "invalid_args" | "not_found" | "db_error" | "missing_function" | "bad_response";
}

export async function rpcMembershipStatus(
  sb: RpcClient,
  membershipId: string,
  status: "active" | "inactive",
): Promise<MembershipStatusOutcome> {
  try {
    const { data, error } = await sb.rpc(MENTOR_RPCS.membershipStatus.fn, {
      p_membership_id: membershipId,
      p_status: status,
    });
    if (error) return { ok: false, userId: null, reason: isMissingObjectError(error) ? "missing_function" : "db_error" };
    const o = obj(data);
    if (!o || typeof o.ok !== "boolean") return { ok: false, userId: null, reason: "bad_response" };
    if (!o.ok) {
      const r = o.reason;
      return { ok: false, userId: null, reason: r === "not_found" || r === "invalid_args" || r === "db_error" ? r : "bad_response" };
    }
    return { ok: true, userId: strOrNull(o.user_id) };
  } catch {
    return { ok: false, userId: null, reason: "db_error" };
  }
}

// ─── mentor_whop_lookup ─────────────────────────────────────────────────

export type WhopLookup =
  | { kind: "mentor"; via: "payment" | "membership"; userId: string | null; packageId: MentorPackageId | null }
  | { kind: "not_mentor" }
  /** The RPC does not exist (ledger migration not applied): no mentor lot can exist. */
  | { kind: "missing_function" }
  | { kind: "error" };

export async function rpcWhopLookup(
  sb: RpcClient,
  paymentId: string | null,
  membershipId: string | null,
): Promise<WhopLookup> {
  if (!paymentId && !membershipId) return { kind: "not_mentor" };
  try {
    const { data, error } = await sb.rpc(MENTOR_RPCS.whopLookup.fn, {
      p_payment_id: paymentId,
      p_membership_id: membershipId,
    });
    if (error) return isMissingObjectError(error) ? { kind: "missing_function" } : { kind: "error" };
    const o = obj(data);
    if (!o || typeof o.mentor !== "boolean") return { kind: "error" };
    if (!o.mentor) return { kind: "not_mentor" };
    const via = o.via === "membership" ? "membership" : o.via === "payment" ? "payment" : null;
    if (!via) return { kind: "error" };
    return {
      kind: "mentor",
      via,
      userId: isUuid(o.user_id) ? o.user_id : null,
      packageId: isMentorPackageId(o.package_id) ? o.package_id : null,
    };
  } catch {
    return { kind: "error" };
  }
}

// ─── mentor_balance ─────────────────────────────────────────────────────

export interface BalanceLotRow {
  lot_id: string;
  package_id: MentorPackageId;
  kind: string;
  source: CreditLotSource;
  remaining_micro: number;
  granted_micro: number;
  starts_at: string;
  expires_at: string;
}

export interface BalanceRow {
  lots_micro: number;
  reserved_micro: number;
  debt_micro: number;
  available_micro: number;
  next_expiry: string | null;
  ever_granted: boolean;
  lots: BalanceLotRow[];
}

/** Throws on any DB or shape error (the Wallet contract: callers fail closed). */
export async function rpcBalance(sb: RpcClient, userId: string): Promise<BalanceRow> {
  if (!isUuid(userId)) throw new Error("mentor_balance: invalid user id");
  const { data, error } = await sb.rpc(MENTOR_RPCS.balance.fn, { p_user: userId });
  if (error) throw new Error(`mentor_balance failed: ${error.code ?? "unknown"}`);
  const o = obj(data);
  const lotsMicro = num(o?.lots_micro);
  const reserved = num(o?.reserved_micro);
  const debt = num(o?.debt_micro);
  const available = num(o?.available_micro);
  if (!o || lotsMicro === null || reserved === null || debt === null || available === null || typeof o.ever_granted !== "boolean") {
    throw new Error("mentor_balance: unexpected response shape");
  }
  const lots: BalanceLotRow[] = [];
  for (const raw of Array.isArray(o.lots) ? o.lots : []) {
    const l = obj(raw);
    if (!l) continue;
    const remaining = num(l.remaining_micro);
    const granted = num(l.granted_micro);
    if (
      typeof l.lot_id !== "string" ||
      !isMentorPackageId(l.package_id) ||
      typeof l.kind !== "string" ||
      typeof l.source !== "string" ||
      remaining === null ||
      granted === null ||
      typeof l.starts_at !== "string" ||
      typeof l.expires_at !== "string"
    ) {
      throw new Error("mentor_balance: unexpected lot shape");
    }
    lots.push({
      lot_id: l.lot_id,
      package_id: l.package_id,
      kind: l.kind,
      source: l.source as CreditLotSource,
      remaining_micro: remaining,
      granted_micro: granted,
      starts_at: l.starts_at,
      expires_at: l.expires_at,
    });
  }
  return {
    lots_micro: lotsMicro,
    reserved_micro: reserved,
    debt_micro: debt,
    available_micro: available,
    next_expiry: strOrNull(o.next_expiry),
    ever_granted: o.ever_granted,
    lots,
  };
}
