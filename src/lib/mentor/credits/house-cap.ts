/**
 * G0 (d) per-account monthly house-cost cap (a-free-credit-hooks).
 *
 * Refusals, notices and our-side failures are paid by the house, bounded only
 * by the daily attempt limit. Once free credits reach accounts beyond the
 * allowlist, one account could create about USD 3 of house cost a month. The
 * rule, for scope-admitted accounts only (the allowlist is unchanged):
 *
 *   applies    MENTOR_HOUSE_GRANTS_SCOPE=signed_in, or the account holds a
 *              live lot from a free credit hook (welcome, code, reward)
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

import { FREE_CREDIT_HOOK_SOURCES, HOUSE_FUNDED_TASTE_SOURCES, type FreeCreditConfig } from "./free-credits";
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
export function houseCapConsidered(fc: Pick<FreeCreditConfig, "houseGrantsScope" | "welcomeEnabled" | "campaignEnabled" | "experienceEnabled">): boolean {
  return fc.houseGrantsScope === "signed_in" || fc.welcomeEnabled || fc.campaignEnabled || fc.experienceEnabled;
}

/** Does the cap apply to this admission at all? */
export function houseCapApplies(via: MentorAdmissionVia | null, fc: Pick<FreeCreditConfig, "houseGrantsScope">, lots: readonly HouseCapLot[], nowMs: number): boolean {
  if (via !== "scope") return false;
  if (fc.houseGrantsScope === "signed_in") return true;
  return liveLots(lots, nowMs).some((l) => FREE_CREDIT_HOOK_SOURCES.has(l.source));
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
