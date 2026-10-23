/**
 * Partner kit server reads (a-partner-kit): service-role SELECTs only. No write,
 * no migration. Server only (script, admin route, report page).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { campaignLive } from "@/lib/mentor/credits/campaign";
import { normalizeCampaignCode, readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { SEAT_MAX_ACCOUNT_AGE_DAYS } from "@/lib/seed-seats";
import type { PartnerRaw } from "./report";
import { partnerAccountMaxAgeDays, type PartnerCodeInfo } from "./index";

type Db = Pick<SupabaseClient, "from">;

const PAGE = 1000;
const MAX_PAGES = 50;
const DAY = 86_400_000;

interface CampaignRowLike {
  code: string;
  credits: number;
  expiry_days: number;
  starts_at: string;
  ends_at: string;
  active: boolean;
  kind?: string | null;
  pro_days?: number | null;
}

/**
 * A live code's facts for the handout, or null (unknown, paused, ended, not
 * started, unreadable). The kind column exists only after 20270105090000, so a
 * missing column is retried without it and the code reads as a credits code.
 */
export async function readPartnerCodeInfo(sb: Db, rawCode: unknown, now: Date): Promise<PartnerCodeInfo | null> {
  const code = normalizeCampaignCode(rawCode);
  if (!code) return null;
  let { data, error } = await sb.from("ai_credit_campaign").select("code, credits, expiry_days, starts_at, ends_at, active, kind, pro_days").eq("code", code).maybeSingle();
  // Retry without the kind column only when the column is missing (before 20270105090000), never on a transient error.
  if (error && (error.code === "42703" || /column/i.test(error.message ?? ""))) ({ data, error } = await sb.from("ai_credit_campaign").select("code, credits, expiry_days, starts_at, ends_at, active").eq("code", code).maybeSingle());
  if (error || !data) return null;
  const row = data as unknown as CampaignRowLike;
  if (!campaignLive(row, now)) return null;
  const seat = row.kind === "seat" && !!row.pro_days;
  return {
    code: row.code,
    kind: seat ? "seat" : "credits",
    credits: row.credits,
    expiryDays: row.expiry_days,
    proDays: seat ? (row.pro_days as number) : null,
    maxAccountAgeDays: partnerAccountMaxAgeDays(row.code, seat ? SEAT_MAX_ACCOUNT_AGE_DAYS : readFreeCreditConfig().campaignAccountMaxAgeDays),
    endsAt: row.ends_at,
  };
}

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await read(p * PAGE, p * PAGE + PAGE - 1);
    if (error || !Array.isArray(data)) return null;
    out.push(...data);
    if (data.length < PAGE) return out;
  }
  return null;
}

export interface Redemption { user_id: string; redeemed_at: string }

/** Every redemption of the code (one row per account), or null when unreadable. */
export async function readRedemptions(sb: Db, code: string): Promise<Redemption[] | null> {
  return pageAll<Redemption>((a, b) => sb.from("ai_credit_campaign_redemption").select("user_id, redeemed_at").eq("code", code).order("redeemed_at").order("user_id").range(a, b) as unknown as PromiseLike<{ data: Redemption[] | null; error: unknown }>);
}

/** Answers of the given learners since `since`, as (user, time) pairs; null when unreadable or too long. */
export async function readAnswerTimes(sb: Db, userIds: string[], sinceIso: string): Promise<Array<{ user_id: string; created_at: string }> | null> {
  const out: Array<{ user_id: string; created_at: string }> = [];
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const rows = await pageAll<{ user_id: string; created_at: string }>((a, b) => sb.from("answer_history").select("user_id, created_at").in("user_id", chunk).gte("created_at", sinceIso).order("created_at").order("id").range(a, b) as unknown as PromiseLike<{ data: Array<{ user_id: string; created_at: string }> | null; error: unknown }>);
    if (!rows) return null;
    out.push(...rows);
  }
  return out;
}

/** The three raw totals of one code, or null when any read failed (never a low number by accident). */
export async function readPartnerRaw(sb: Db, rawCode: unknown, now: Date): Promise<PartnerRaw | null> {
  const code = normalizeCampaignCode(rawCode);
  if (!code) return null;
  const reds = await readRedemptions(sb, code);
  if (!reds) return null;
  if (reds.length === 0) return { redemptions: 0, active7d: 0, answerers: 0, answers: 0 };
  const redeemedAt = new Map(reds.map((r) => [r.user_id, Date.parse(r.redeemed_at)]));
  const since = new Date(Math.min(...[...redeemedAt.values()].filter(Number.isFinite))).toISOString();
  const rows = await readAnswerTimes(sb, [...redeemedAt.keys()], since);
  if (!rows) return null;
  const weekAgo = now.getTime() - 7 * DAY;
  const answerers = new Set<string>();
  const active = new Set<string>();
  let answers = 0;
  for (const r of rows) {
    const t = Date.parse(r.created_at);
    const from = redeemedAt.get(r.user_id);
    if (!Number.isFinite(t) || from === undefined || !Number.isFinite(from) || t < from) continue;
    answers += 1;
    answerers.add(r.user_id);
    if (t >= weekAgo) active.add(r.user_id);
  }
  return { redemptions: reds.length, active7d: active.size, answerers: answerers.size, answers };
}
