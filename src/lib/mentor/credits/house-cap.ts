/**
 * G0 (d) per-account monthly house-cost cap (a-free-credit-hooks).
 *
 * Refusals, notices and our-side failures are paid by the house, bounded only
 * by the daily attempt limit. Once free credits reach accounts beyond the
 * allowlist, one account could create about USD 3 of house cost a month. The
 * rule, for scope-admitted accounts only (the allowlist is unchanged):
 *
 *   applies    MENTOR_HOUSE_GRANTS_SCOPE=signed_in, or the account holds a
 *              live lot from a free credit hook (welcome, code, reward), or
 *              REWARDS_WINBACK_ENABLED is on and it holds a live admin_gift
 *              lot (win-back lots are admin_gift with a reward:winback: key;
 *              mentor_balance returns no key, so every live admin_gift lot
 *              counts while that flag is on)
 *   cap        USD 0.10 (100,000 micro) when every live lot is a free lot
 *              (tastes, welcome, codes, rewards, gifts); USD 0.25 otherwise;
 *              both in env (free-credits.ts)
 *   above cap  free-only accounts: no new message until the next UTC month
 *              (daily limit 0, the existing "daily limit" 429); others: half
 *              the daily limit ("house turns count double").
 *
 * The month is the UTC calendar month, the same window as the spend breaker
 * (ai_spend_month). Pure; the route reads the month's house cost.
 */

import { FREE_CREDIT_HOOK_SOURCES, HOUSE_FUNDED_TASTE_SOURCES, WINBACK_LOT, type FreeCreditConfig } from "./free-credits";
import type { MentorAdmissionVia } from "../access";

export interface HouseCapLot {
  source: string;
  remainingMicro: number;
  startsAt: string;
  expiresAt: string;
}

export type HouseCapState = "off" | "under" | "halved" | "blocked";

export function liveLots<T extends HouseCapLot>(lots: readonly T[], nowMs: number): T[] {
  return lots.filter((l) => l.remainingMicro > 0 && Date.parse(l.startsAt) <= nowMs && Date.parse(l.expiresAt) > nowMs);
}

/** Every live lot is a free lot (and there is at least one). */
export function fundedOnlyByFreeLots(lots: readonly HouseCapLot[], nowMs: number): boolean {
  const live = liveLots(lots, nowMs);
  return live.length > 0 && live.every((l) => HOUSE_FUNDED_TASTE_SOURCES.has(l.source));
}

/** Any free credit hook on? Otherwise the chat route skips the cap reads entirely. */
export function houseCapConsidered(fc: Pick<FreeCreditConfig, "houseGrantsScope" | "welcomeEnabled" | "campaignEnabled" | "experienceEnabled"> & Partial<Pick<FreeCreditConfig, "winbackEnabled" | "rewardLotsEnabled" | "seatsEnabled">>): boolean {
  // a-seed-seats: a seat's credits are a campaign_code lot (a hook lot), so seats switch the cap on too.
  return fc.houseGrantsScope === "signed_in" || fc.welcomeEnabled || fc.campaignEnabled || fc.experienceEnabled || fc.winbackEnabled === true || fc.rewardLotsEnabled === true || fc.seatsEnabled === true;
}

/**
 * A live lot from a free credit hook. a-rewards-program: while a reward flag
 * is on, an admin_gift lot counts too (reward lots use admin_gift with a
 * reward: key; mentor_balance returns no key). Side effect: a scope-admitted
 * account whose only live lots are comped-Pro admin_gift lots gets the taste
 * cap and, above it, no new message until the next UTC month. Rare (included
 * grants are allowlist-only unless MENTOR_HOUSE_GRANTS_SCOPE=signed_in, which
 * applies the cap anyway); listed in the a-rewards-program release note.
 * J11 (a-winback-credits): while REWARDS_WINBACK_ENABLED is on, the win-back
 * lot source counts the same way.
 */
function isHookLot(l: HouseCapLot, rewardLotsEnabled: boolean, winbackEnabled: boolean): boolean {
  return FREE_CREDIT_HOOK_SOURCES.has(l.source) || (rewardLotsEnabled && l.source === "admin_gift") || (winbackEnabled && l.source === WINBACK_LOT.source);
}

/** Does the cap apply to this admission at all? */
export function houseCapApplies(via: MentorAdmissionVia | null, fc: Pick<FreeCreditConfig, "houseGrantsScope"> & Partial<Pick<FreeCreditConfig, "winbackEnabled" | "rewardLotsEnabled">>, lots: readonly HouseCapLot[], nowMs: number): boolean {
  if (via !== "scope") return false;
  if (fc.houseGrantsScope === "signed_in") return true;
  return liveLots(lots, nowMs).some((l) => isHookLot(l, fc.rewardLotsEnabled === true, fc.winbackEnabled === true));
}

export function houseCapDecision(args: {
  lots: readonly HouseCapLot[];
  nowMs: number;
  houseCostMicro: number;
  ratePerDay: number;
  fc: Pick<FreeCreditConfig, "houseCostCapMicro" | "houseCostCapTasteMicro">;
}): { state: Exclude<HouseCapState, "off">; ratePerDay: number; capMicro: number } {
  const tasteOnly = fundedOnlyByFreeLots(args.lots, args.nowMs);
  const capMicro = tasteOnly ? args.fc.houseCostCapTasteMicro : args.fc.houseCostCapMicro;
  if (!(args.houseCostMicro >= capMicro)) return { state: "under", ratePerDay: args.ratePerDay, capMicro };
  if (tasteOnly) return { state: "blocked", ratePerDay: 0, capMicro };
  return { state: "halved", ratePerDay: Math.floor(args.ratePerDay / 2), capMicro };
}

/** First instant of the UTC month containing `now`. */
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

type FromDb = { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The account's house cost (micro-USD) this UTC month: house_cost ledger rows
 * by (user_id, created_at) index. At most 60 turns a day, so 5,000 rows cover
 * a month; a read error throws (the chat route answers 503 reserve_failed).
 */
export async function readHouseCostThisMonth(db: FromDb, userId: string, now: Date): Promise<number> {
  const { data, error } = await db.from("ai_usage_ledger").select("cost_micro")
    .eq("user_id", userId).eq("kind", "house_cost").gte("created_at", utcMonthStart(now).toISOString()).limit(5000);
  if (error) throw new Error(`house cost read failed: ${error.code ?? "unknown"}`);
  let sum = 0;
  for (const r of (data ?? []) as Array<{ cost_micro: number | string | null }>) {
    const n = Number(r.cost_micro);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}
