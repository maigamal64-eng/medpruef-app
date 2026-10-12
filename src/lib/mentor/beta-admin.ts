/**
 * Free mentor beta ([name], 12 Oct 2026): admin enrolment and usage.
 *
 * Enrolment puts each user on the mentor allowlist (ai_mentor_beta_override,
 * audited through mentor_set_beta) and grants a one-time beta credit lot.
 * The grant is idempotent per user and cohort key: lot source "beta_grant",
 * source_id "beta-2026-10:<user_id>", so running the same list twice never
 * funds anyone twice (UNIQUE (source, source_id) in the ledger).
 *
 * Usage reads mentor_beta_usage (migration 20261022130000_mentor_beta.sql):
 * messages, failures, credits used and true API cost per beta user.
 * Nothing here touches flags, prices, Whop or the env.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { CREDIT_MICRO_USD, creditsExactFromMicro } from "./config";
import { isUuid, rpcGrantCredits } from "./credits/db";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export const MENTOR_BETA_KEY = "beta-2026-10";
/** Usage window start for the beta cohort. */
export const MENTOR_BETA_SINCE = "2026-10-01T00:00:00Z";
export const MENTOR_BETA_MAX_USERS = 100;
export const MENTOR_BETA_MAX_CREDITS = 200;
export const MENTOR_BETA_LOT_DAYS = 30;

export function betaSourceId(userId: string, key: string = MENTOR_BETA_KEY): string {
  return `${key}:${userId.toLowerCase()}`;
}

export type BetaInput =
  | { ok: true; userIds: string[]; credits: number }
  | { ok: false; error: "invalid_users" | "too_many_users" | "invalid_credits" };

/** Validates the admin request body: unique lowercase UUIDs and whole credits. */
export function parseBetaInput(raw: unknown): BetaInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_users" };
  const b = raw as { user_ids?: unknown; credits?: unknown };
  if (!Array.isArray(b.user_ids) || b.user_ids.length === 0) return { ok: false, error: "invalid_users" };
  if (b.user_ids.length > MENTOR_BETA_MAX_USERS) return { ok: false, error: "too_many_users" };
  const ids: string[] = [];
  for (const v of b.user_ids) {
    if (typeof v !== "string" || !isUuid(v.trim())) return { ok: false, error: "invalid_users" };
    const id = v.trim().toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  const credits = b.credits;
  if (typeof credits !== "number" || !Number.isInteger(credits) || credits < 1 || credits > MENTOR_BETA_MAX_CREDITS) {
    return { ok: false, error: "invalid_credits" };
  }
  return { ok: true, userIds: ids, credits };
}

export type BetaEnrolStatus = "granted" | "already_granted" | "unknown_user" | "allowlist_failed" | "grant_failed";
export interface BetaEnrolResult {
  user_id: string;
  status: BetaEnrolStatus;
  allowlisted: boolean;
}

/**
 * Allowlist then grant, one user at a time. A grant failure leaves the user
 * allowlisted (they see the mentor with whatever credits they hold) and is
 * reported per row; a rerun retries only what failed.
 */
export async function enrolBetaUsers(db: Db, actorId: string, userIds: string[], credits: number, now: Date): Promise<BetaEnrolResult[]> {
  const { data, error } = await db.from("users").select("id").in("id", userIds);
  if (error) throw new Error("beta user read failed");
  const known = new Set(((data ?? []) as Array<{ id: string }>).map((r) => String(r.id).toLowerCase()));
  const expiresAt = new Date(now.getTime() + MENTOR_BETA_LOT_DAYS * 86_400_000);
  const out: BetaEnrolResult[] = [];
  for (const id of userIds) {
    if (!known.has(id)) { out.push({ user_id: id, status: "unknown_user", allowlisted: false }); continue; }
    const allow = await db.rpc("mentor_set_beta", { p_user: id, p_allowed: true, p_actor: actorId });
    if (allow.error) { out.push({ user_id: id, status: "allowlist_failed", allowlisted: false }); continue; }
    const g = await rpcGrantCredits(db, {
      userId: id,
      packageId: "beta_grant",
      source: "beta_grant",
      sourceId: betaSourceId(id),
      micro: credits * CREDIT_MICRO_USD,
      startsAt: now,
      expiresAt,
    });
    out.push({ user_id: id, allowlisted: true, status: g.ok ? (g.duplicate ? "already_granted" : "granted") : "grant_failed" });
  }
  return out;
}

export interface BetaUsageRow {
  user_id: string;
  first_name: string | null;
  messages: number;
  failures: number;
  blocked: number;
  credits_used: number;
  cost_micro: number;
  beta_credits: number;
  credits_left: number;
  last_turn_at: string | null;
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Allowlisted users (DB rows) with their usage since the beta start. */
export async function loadBetaUsage(db: Db, since: string = MENTOR_BETA_SINCE): Promise<BetaUsageRow[]> {
  const list = await db.from("ai_mentor_beta_override").select("user_id").eq("allowed", true).order("updated_at", { ascending: false }).limit(200);
  if (list.error) throw new Error("beta list read failed");
  const ids = ((list.data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  if (ids.length === 0) return [];
  const [usage, names] = await Promise.all([
    db.rpc("mentor_beta_usage", { p_users: ids, p_since: since }),
    db.from("users").select("id,first_name").in("id", ids),
  ]);
  if (usage.error || !Array.isArray(usage.data)) throw new Error("beta usage read failed");
  if (names.error) throw new Error("beta names read failed");
  const nameOf = new Map(((names.data ?? []) as Array<{ id: string; first_name: string | null }>).map((r) => [r.id, r.first_name]));
  return (usage.data as Array<Record<string, unknown>>).map((r) => ({
    user_id: String(r.user_id),
    first_name: nameOf.get(String(r.user_id)) ?? null,
    messages: n(r.messages),
    failures: n(r.failures),
    blocked: n(r.blocked),
    credits_used: Math.round(creditsExactFromMicro(n(r.credits_used_micro)) * 100) / 100,
    cost_micro: n(r.cost_micro),
    beta_credits: Math.round(creditsExactFromMicro(n(r.beta_granted_micro)) * 100) / 100,
    credits_left: Math.round(creditsExactFromMicro(n(r.remaining_micro)) * 100) / 100,
    last_turn_at: typeof r.last_turn_at === "string" ? r.last_turn_at : null,
  })).sort((a, b) => b.messages - a.messages || a.user_id.localeCompare(b.user_id));
}
