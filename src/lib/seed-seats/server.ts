/**
 * Seed seats, server side (a-seed-seats). Rules and who may take a seat:
 * ./index.ts. The grant itself is one SQL transaction
 * (mentor_redeem_seat_code, 20270105090000): this module reads which kind a
 * code is, calls the function and maps its answer. The function computes the
 * one-seat-per-person key itself, under the users row lock, from the
 * confirmed address the row holds (seed_seat_identity_key); nothing here can
 * grant around it. Service role only.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseTrialEmail } from "@/lib/pricing-v2/reverse-trial";
import { normalizeCampaignCode } from "@/lib/mentor/credits/free-credits";
import { isMissingObjectError, isUuid } from "@/lib/mentor/credits/db";
import type { RedeemVia } from "@/lib/mentor/credits/campaign";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/reverse-trial";
import { SEAT_MAX_ACCOUNT_AGE_DAYS, SEAT_PRO_DAYS, SEAT_TIER } from "./index";

type Db = Pick<SupabaseClient, "from" | "rpc">;

/**
 * The one-seat-per-person key of an address, as the database computes it
 * (seed_seat_identity_key): sha256 over the normalised address (the reverse
 * trial's rules: trimmed, lower-cased, +tag dropped, Gmail dots dropped),
 * with its own prefix so it never equals a reverse-trial key. null when there
 * is no usable address. A mirror for admin tooling and the PG16 proof, which
 * checks that both give the same key; the grant never takes a key from here.
 */
export function seatIdentityKey(email: string | null | undefined): string | null {
  const normalised = normaliseTrialEmail(email);
  return normalised ? createHash("sha256").update(`seed-seat:${normalised}`).digest("hex") : null;
}

export type CodeKind = "credits" | "seat";

/**
 * Which kind of code is this? null for an unknown code, a code that cannot
 * be one, or a database without the kind column (before 20270105090000 every
 * code is a credits code). Throws on any other read error.
 */
export async function readCodeKind(sb: Pick<SupabaseClient, "from">, rawCode: unknown): Promise<CodeKind | null> {
  const code = normalizeCampaignCode(rawCode);
  if (!code) return null;
  const { data, error } = await sb.from("ai_credit_campaign").select("kind").eq("code", code).maybeSingle();
  if (error) {
    if (isMissingObjectError(error) || (error as { code?: string }).code === "42703") return null;
    throw new Error(`campaign kind read failed: ${error.code ?? "unknown"}`);
  }
  const kind = (data as { kind?: unknown } | null)?.kind;
  return kind === "seat" ? "seat" : kind === "credits" ? "credits" : null;
}

export const SEAT_REASONS = [
  "invalid_args",
  "unknown_code",
  "inactive",
  "not_started",
  "expired",
  "banned",
  "account_too_old",
  "unverified",
  "paid_before",
  "already_pro",
  "identity_used",
  "already_redeemed",
  "cap_reached",
  "daily_cap",
  "db_error",
  "missing_function",
] as const;
export type SeatReason = (typeof SEAT_REASONS)[number];

export type SeatOutcome =
  | { ok: true; duplicate: boolean; credits: number; seatEndsAt: string | null; code: string }
  | { ok: false; reason: SeatReason };

/** Redeem a seat code for a signed-in account (the function decides everything). */
export async function redeemSeatCode(sb: Db, userId: string, rawCode: unknown, via: RedeemVia, maxAgeDays: number = SEAT_MAX_ACCOUNT_AGE_DAYS): Promise<SeatOutcome> {
  const code = normalizeCampaignCode(rawCode);
  if (!code || !isUuid(userId) || (via !== "landing" && via !== "settings")) return { ok: false, reason: "invalid_args" };
  try {
    const { data, error } = await sb.rpc("mentor_redeem_seat_code", {
      p_user: userId,
      p_code: code,
      p_via: via,
      p_max_account_age_days: Math.min(SEAT_MAX_ACCOUNT_AGE_DAYS, Math.max(1, Math.floor(maxAgeDays))),
    });
    if (error) return { ok: false, reason: isMissingObjectError(error) ? "missing_function" : "db_error" };
    const o = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!o || typeof o.ok !== "boolean") return { ok: false, reason: "db_error" };
    if (!o.ok) {
      const r = String(o.reason);
      return { ok: false, reason: (SEAT_REASONS as readonly string[]).includes(r) ? (r as SeatReason) : "db_error" };
    }
    const credits = Number(o.credits);
    return {
      ok: true,
      duplicate: o.duplicate === true,
      credits: Number.isFinite(credits) ? credits : 0,
      seatEndsAt: typeof o.seat_ends_at === "string" ? o.seat_ends_at : null,
      code: typeof o.code === "string" ? o.code : code,
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

/** Settings card: may this account still take a seat (cheap pre-check; the function decides)? */
export async function readSeatStatus(
  sb: Pick<SupabaseClient, "from">, userId: string, now: Date,
): Promise<{ eligible: boolean; needs_verification: boolean }> {
  const { data, error } = await sb.from("users")
    .select("created_at, email_verified_at, telegram_id, is_banned, role, tier, tier_expires_at").eq("id", userId).maybeSingle();
  if (error) throw error;
  const u = data as { created_at?: string | null; email_verified_at?: string | null; telegram_id?: number | string | null; is_banned?: boolean | null; role?: string | null; tier?: string | null; tier_expires_at?: string | null } | null;
  if (!u || u.is_banned === true || u.role === "admin" || u.tier === "admin") return { eligible: false, needs_verification: false };
  const created = u.created_at ? Date.parse(u.created_at) : NaN;
  if (!Number.isFinite(created) || now.getTime() - created > SEAT_MAX_ACCOUNT_AGE_DAYS * 86_400_000) return { eligible: false, needs_verification: false };
  // Running access other than the 3-day reverse trial is refused by the
  // function (already_pro): open-ended Pro, or Pro ending later than a trial could.
  if (u.tier === "pro") {
    const end = u.tier_expires_at ? Date.parse(u.tier_expires_at) : NaN;
    if (!u.tier_expires_at || (Number.isFinite(end) && end > now.getTime() + (REVERSE_TRIAL_DAYS + 1) * 86_400_000)) {
      return { eligible: false, needs_verification: false };
    }
  }
  const verified = (typeof u.email_verified_at === "string" && u.email_verified_at !== "") || (u.telegram_id !== null && u.telegram_id !== undefined && String(u.telegram_id) !== "");
  return { eligible: verified, needs_verification: !verified };
}

/** The account's seat end, when its one redemption was a seat (Settings shows it). Throws on a read error. */
export async function readSeatEnd(sb: Pick<SupabaseClient, "from">, userId: string): Promise<string | null> {
  const { data, error } = await sb.from("ai_credit_campaign_redemption").select("seat_ends_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingObjectError(error) || (error as { code?: string }).code === "42703") return null;
    throw new Error(`seat read failed: ${error.code ?? "unknown"}`);
  }
  const end = (data as { seat_ends_at?: unknown } | null)?.seat_ends_at;
  return typeof end === "string" ? end : null;
}

/**
 * The landing page's view of a seat code: only a live seat code is described
 * (unknown, paused, ended, not started, full read error: null, the neutral
 * page). Reads the kind column, so it is called only while seats are on.
 */
export async function readLiveSeat(sb: Pick<SupabaseClient, "from">, rawCode: unknown, now: Date): Promise<{ code: string; credits: number; proDays: number } | null> {
  const code = normalizeCampaignCode(rawCode);
  if (!code) return null;
  try {
    const { data, error } = await sb.from("ai_credit_campaign").select("code, kind, credits, pro_days, starts_at, ends_at, active").eq("code", code).maybeSingle();
    if (error || !data) return null;
    const row = data as { code: string; kind: string; credits: number; pro_days: number | null; starts_at: string; ends_at: string; active: boolean };
    const s = Date.parse(row.starts_at);
    const e = Date.parse(row.ends_at);
    const live = row.active && Number.isFinite(s) && Number.isFinite(e) && s <= now.getTime() && now.getTime() < e;
    if (row.kind !== "seat" || !live || !row.pro_days) return null;
    return { code: row.code, credits: row.credits, proDays: row.pro_days };
  } catch {
    return null;
  }
}

/**
 * Seat-only access for /api/auth/me (a-seed-seats reviewer P1): the end of a
 * running seed seat when the account's access comes only from it (plus at
 * most the reverse trial it extended). /pricing then treats the learner as a
 * buyer, as checkout already does (accessIsReverseTrialOnly). One read, only
 * for a young account whose Pro ends within a seat's length; null otherwise
 * and on any read error (the page keeps its paid view, never a wrong offer).
 */
export async function seatOnlyAccess(
  sb: Pick<SupabaseClient, "from">,
  userId: string,
  c: { createdAt: string | null; role: string | null; tier: string | null; tierExpiresAt: string | null },
  now: Date = new Date(),
): Promise<{ endsAt: string } | null> {
  if (c.role === "admin" || c.tier !== "pro" || !c.tierExpiresAt) return null;
  const end = Date.parse(c.tierExpiresAt);
  const created = c.createdAt ? Date.parse(c.createdAt) : NaN;
  const day = 86_400_000;
  if (!Number.isFinite(end) || end <= now.getTime() || end > now.getTime() + (SEAT_PRO_DAYS + 1) * day) return null;
  if (!Number.isFinite(created) || created < now.getTime() - (SEAT_MAX_ACCOUNT_AGE_DAYS + SEAT_PRO_DAYS + 1) * day) return null;
  try {
    const { data, error } = await sb.from("subscriptions").select("tier, expires_at").eq("user_id", userId).eq("status", "active");
    if (error) return null;
    const live = ((data ?? []) as Array<{ tier: string | null; expires_at: string | null }>).filter((r) => {
      const t = r.expires_at ? Date.parse(r.expires_at) : NaN;
      return !r.expires_at || (Number.isFinite(t) && t > now.getTime());
    });
    const seats = live.filter((r) => r.tier === SEAT_TIER && r.expires_at);
    if (seats.length === 0 || !live.every((r) => r.tier === SEAT_TIER || r.tier === "reverse_trial")) return null;
    const seatEnd = Math.max(...seats.map((r) => Date.parse(String(r.expires_at))));
    if (end > seatEnd + 60_000) return null;
    return { endsAt: new Date(seatEnd).toISOString() };
  } catch {
    return null;
  }
}
