/**
 * Campaign codes (a-free-credit-hooks, marketing M9 and the Telegram groups):
 * admin-made codes (e.g. TG-SPT, TG-SIP, WNWMED, FRISTEN) that add mentor
 * credits once per account. MENTOR_CAMPAIGN_CODES_ENABLED, default OFF.
 *
 * The whole redemption runs in one SQL function (mentor_redeem_campaign_code,
 * 20270102090000): code live, account not banned and created within
 * campaignAccountMaxAgeDays (7), one redemption per account whatever the code,
 * total and Vienna-day caps under the code row lock, then mentor_grant_credits
 * (source campaign_code, key campaign:<user>) and the redemption row. Nothing
 * here can grant around it. Server only (service-role client).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCampaignCode } from "./free-credits";
import { isMissingObjectError, isUuid } from "./db";
import { isVerifiedAccount } from "./included";
import { SEAT_PRO_DAYS, SEAT_VENUE_CAP } from "@/lib/seed-seats";

type Db = Pick<SupabaseClient, "from" | "rpc">;

export type RedeemVia = "landing" | "settings";

/** a-seed-seats: the table CHECK of 20270105090000 holds the same bounds (owner: src/lib/seed-seats). */
export const SEAT_CODE_LIMITS = Object.freeze({ proDays: SEAT_PRO_DAYS, maxTotal: SEAT_VENUE_CAP } as const);

export const REDEEM_REASONS = [
  "invalid_args",
  "unknown_code",
  "inactive",
  "not_started",
  "expired",
  "banned",
  "account_too_old",
  "unverified",
  "already_redeemed",
  "cap_reached",
  "daily_cap",
  "grant_failed",
  "db_error",
  "missing_function",
] as const;
export type RedeemReason = (typeof REDEEM_REASONS)[number];

export type RedeemOutcome =
  | { ok: true; duplicate: boolean; credits: number; expiresAt: string | null; code: string }
  | { ok: false; reason: RedeemReason };

export async function redeemCampaignCode(sb: Db, userId: string, rawCode: unknown, via: RedeemVia, maxAgeDays: number): Promise<RedeemOutcome> {
  const code = normalizeCampaignCode(rawCode);
  if (!code || !isUuid(userId) || (via !== "landing" && via !== "settings")) return { ok: false, reason: "invalid_args" };
  try {
    const { data, error } = await sb.rpc("mentor_redeem_campaign_code", { p_user: userId, p_code: code, p_via: via, p_max_account_age_days: maxAgeDays });
    if (error) return { ok: false, reason: isMissingObjectError(error) ? "missing_function" : "db_error" };
    const o = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!o || typeof o.ok !== "boolean") return { ok: false, reason: "db_error" };
    if (!o.ok) {
      const r = o.reason;
      return { ok: false, reason: (REDEEM_REASONS as readonly string[]).includes(String(r)) ? (r as RedeemReason) : "db_error" };
    }
    const credits = Number(o.credits);
    return {
      ok: true,
      duplicate: o.duplicate === true,
      credits: Number.isFinite(credits) ? credits : 0,
      expiresAt: typeof o.expires_at === "string" ? o.expires_at : null,
      code: typeof o.code === "string" ? o.code : code,
    };
  } catch {
    return { ok: false, reason: "db_error" };
  }
}

export interface CampaignRow {
  code: string;
  label: string;
  credits: number;
  expiry_days: number;
  total_cap: number;
  daily_cap: number;
  starts_at: string;
  ends_at: string;
  active: boolean;
  note: string | null;
  created_at: string;
  /** a-seed-seats (20270105090000): "seat" codes give pro_days of Pro plus credits. Absent before it. */
  kind?: "credits" | "seat";
  pro_days?: number | null;
}

const CAMPAIGN_COLUMNS = "code, label, credits, expiry_days, total_cap, daily_cap, starts_at, ends_at, active, note, created_at";

/** Is the row redeemable right now (state only; caps are checked in SQL)? */
export function campaignLive(row: Pick<CampaignRow, "active" | "starts_at" | "ends_at">, now: Date): boolean {
  const s = Date.parse(row.starts_at);
  const e = Date.parse(row.ends_at);
  return row.active && Number.isFinite(s) && Number.isFinite(e) && s <= now.getTime() && now.getTime() < e;
}

/**
 * The landing page's view of a code: only a live code is described; every
 * other case (unknown, paused, ended, not started, table missing, read error)
 * is the same null, so the page never confirms that a code exists.
 */
export async function readLiveCampaign(sb: Pick<SupabaseClient, "from">, rawCode: unknown, now: Date): Promise<Pick<CampaignRow, "code" | "credits" | "expiry_days" | "ends_at"> | null> {
  const code = normalizeCampaignCode(rawCode);
  if (!code) return null;
  try {
    const { data, error } = await sb.from("ai_credit_campaign").select("code, credits, expiry_days, starts_at, ends_at, active").eq("code", code).maybeSingle();
    if (error || !data) return null;
    const row = data as CampaignRow;
    return campaignLive(row, now) ? { code: row.code, credits: row.credits, expiry_days: row.expiry_days, ends_at: row.ends_at } : null;
  } catch {
    return null;
  }
}

/** One account's redemption (the Settings card hides itself once redeemed). Throws on a read error. */
export async function readRedemption(sb: Pick<SupabaseClient, "from">, userId: string): Promise<{ code: string; credits: number; redeemed_at: string } | null> {
  const { data, error } = await sb.from("ai_credit_campaign_redemption").select("code, credits, redeemed_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingObjectError(error)) return null;
    throw new Error(`campaign redemption read failed: ${error.code ?? "unknown"}`);
  }
  return (data as { code: string; credits: number; redeemed_at: string } | null) ?? null;
}

/** May this account still redeem (created within the window)? */
export function accountYoungEnough(createdAt: string | null | undefined, now: Date, maxAgeDays: number): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && now.getTime() - t <= maxAgeDays * 86_400_000;
}

// ─── Admin ──────────────────────────────────────────────────────────────

/**
 * Settings card status (GET /api/mentor/campaign/status). Mirrors the account
 * part of mentor_redeem_campaign_code: young enough, no earlier redemption,
 * and verified (email or Telegram) or minAnswers distinct answered questions.
 * A young unverified account reads needs_verification, never eligible, so the
 * card never offers a form the server refuses. Answers are read only then.
 */
export async function readCampaignStatus(
  sb: Pick<SupabaseClient, "from">, userId: string, now: Date, maxAgeDays: number, minAnswers: number,
): Promise<{ eligible: boolean; needs_verification: boolean; redeemed: { code: string; credits: number } | null }> {
  const [user, redeemed] = await Promise.all([
    sb.from("users").select("created_at, email_verified_at, telegram_id").eq("id", userId).maybeSingle(),
    readRedemption(sb, userId),
  ]);
  if (user.error) throw user.error;
  const row = (user.data ?? null) as { created_at?: string | null; email_verified_at?: string | null; telegram_id?: number | string | null } | null;
  const open = !!row && accountYoungEnough(row.created_at, now, maxAgeDays) && !redeemed;
  let verified = true;
  if (open && !isVerifiedAccount({ id: userId, role: null, tier: null, tier_expires_at: null, email_verified_at: row?.email_verified_at ?? null, telegram_id: row?.telegram_id ?? null })) {
    const answers = await sb.from("answer_history").select("question_id").eq("user_id", userId).limit(500);
    if (answers.error) throw answers.error;
    verified = new Set(((answers.data ?? []) as Array<{ question_id: number | null }>).map((r) => r.question_id).filter((q) => q !== null)).size >= minAnswers;
  }
  return {
    eligible: open && verified,
    needs_verification: open && !verified,
    redeemed: redeemed ? { code: redeemed.code, credits: redeemed.credits } : null,
  };
}

export interface CampaignInput {
  /** a-seed-seats: present only for a seat code (a credits insert never names the column). */
  kind?: "seat";
  pro_days?: number;
  code: string;
  label: string;
  credits: number;
  expiry_days: number;
  total_cap: number;
  daily_cap: number;
  ends_at: string;
  note: string | null;
}

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Validates an admin create body; the same bounds as the table CHECKs. */
export function parseCampaignInput(body: unknown, now: Date): { ok: true; value: CampaignInput } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const code = normalizeCampaignCode(b.code);
  if (!code) return { ok: false, error: "Code: 3 to 24 letters, digits or single hyphens." };
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (label.length < 1 || label.length > 80) return { ok: false, error: "Label: 1 to 80 characters." };
  const credits = intIn(b.credits, 1, 1000);
  if (credits === null) return { ok: false, error: "Credits: a whole number from 1 to 1000." };
  const expiry = intIn(b.expiry_days, 1, 180);
  if (expiry === null) return { ok: false, error: "Expiry: 1 to 180 days." };
  const total = intIn(b.total_cap, 1, 10_000);
  if (total === null) return { ok: false, error: "Total cap: 1 to 10000." };
  const daily = intIn(b.daily_cap, 1, 10_000);
  if (daily === null || daily > total) return { ok: false, error: "Daily cap: 1 to the total cap." };
  const ends = typeof b.ends_at === "string" ? Date.parse(b.ends_at) : NaN;
  if (!Number.isFinite(ends) || ends <= now.getTime()) return { ok: false, error: "End date: a future date." };
  if (ends - now.getTime() > 366 * 86_400_000) return { ok: false, error: "End date: at most one year ahead." };
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  if (b.kind === "seat") {
    // a-seed-seats: 30 Pro days, credits valid as long as the seat, at most 20 seats per venue code.
    if (total > SEAT_CODE_LIMITS.maxTotal) return { ok: false, error: `Seat codes: at most ${SEAT_CODE_LIMITS.maxTotal} seats per code.` };
    return { ok: true, value: { kind: "seat", pro_days: SEAT_CODE_LIMITS.proDays, code, label, credits, expiry_days: SEAT_CODE_LIMITS.proDays, total_cap: total, daily_cap: Math.min(daily, total), ends_at: new Date(ends).toISOString(), note } };
  }
  if (b.kind !== undefined && b.kind !== "credits") return { ok: false, error: "Kind: credits or seat." };
  return { ok: true, value: { code, label, credits, expiry_days: expiry, total_cap: total, daily_cap: daily, ends_at: new Date(ends).toISOString(), note } };
}

export interface CampaignStats extends CampaignRow {
  live: boolean;
  redeemed_total: number;
  redeemed_today: number;
  /** Redeemers whose account was created at most 7 days before redeeming (signups this code brought in). */
  new_accounts: number;
  /** Redeemers with a paid subscriptions row after redeeming. */
  payers: number;
}

/** Vienna day start as a UTC instant. */
export function viennaDayStart(now: Date): Date {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => Number(f.find((p) => p.type === t)?.value);
  const sinceMidnightMs = ((g("hour") * 60 + g("minute")) * 60 + g("second")) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - sinceMidnightMs);
}

type RedemptionRow = { code: string; user_id: string; credits: number; via: string; account_created_at: string | null; redeemed_at: string };

/** payers: user id -> creation times of that account's paid subscriptions rows. */
export function summarizeCampaigns(rows: CampaignRow[], redemptions: RedemptionRow[], payers: Map<string, number[]>, now: Date): CampaignStats[] {
  const dayStart = viennaDayStart(now).getTime();
  return rows.map((r) => {
    const mine = redemptions.filter((x) => x.code === r.code);
    return {
      ...r,
      live: campaignLive(r, now),
      redeemed_total: mine.length,
      redeemed_today: mine.filter((x) => Date.parse(x.redeemed_at) >= dayStart).length,
      new_accounts: mine.filter((x) => x.account_created_at && Date.parse(x.redeemed_at) - Date.parse(x.account_created_at) <= 7 * 86_400_000).length,
      payers: mine.filter((x) => (payers.get(x.user_id) ?? []).some((t) => t >= Date.parse(x.redeemed_at))).length,
    };
  });
}

/** Admin list: every code with its counts. Throws on a read error; a missing table answers "not installed". */
export async function loadCampaignStats(sb: Pick<SupabaseClient, "from">, now: Date): Promise<{ installed: boolean; campaigns: CampaignStats[] }> {
  // a-seed-seats: read the kind where 20270105090000 is applied; before it every code is a credits code.
  type CodesRead = { data: unknown[] | null; error: { code?: string } | null };
  let codes: CodesRead = await sb.from("ai_credit_campaign").select(`${CAMPAIGN_COLUMNS}, kind, pro_days`).order("created_at", { ascending: false }).limit(200);
  if (codes.error && codes.error.code === "42703") {
    codes = await sb.from("ai_credit_campaign").select(CAMPAIGN_COLUMNS).order("created_at", { ascending: false }).limit(200);
  }
  if (codes.error) {
    if (isMissingObjectError(codes.error)) return { installed: false, campaigns: [] };
    throw new Error(`campaign read failed: ${codes.error.code ?? "unknown"}`);
  }
  const red = await sb.from("ai_credit_campaign_redemption").select("code, user_id, credits, via, account_created_at, redeemed_at").order("redeemed_at", { ascending: false }).limit(5000);
  if (red.error) throw new Error(`campaign redemption read failed: ${red.error.code ?? "unknown"}`);
  const redemptions = (red.data ?? []) as RedemptionRow[];
  const payers = new Map<string, number[]>();
  const ids = [...new Set(redemptions.map((r) => r.user_id))];
  for (let i = 0; i < ids.length; i += 200) {
    const subs = await sb.from("subscriptions").select("user_id, created_at").in("user_id", ids.slice(i, i + 200)).gt("amount_cents", 0).in("status", ["active", "expired", "cancelled"]);
    if (subs.error) throw new Error(`campaign payer read failed: ${subs.error.code ?? "unknown"}`);
    for (const row of (subs.data ?? []) as Array<{ user_id: string; created_at: string | null }>) {
      const t = row.created_at ? Date.parse(row.created_at) : NaN;
      if (Number.isFinite(t)) payers.set(row.user_id, [...(payers.get(row.user_id) ?? []), t]);
    }
  }
  return { installed: true, campaigns: summarizeCampaigns((codes.data ?? []) as CampaignRow[], redemptions, payers, now) };
}
