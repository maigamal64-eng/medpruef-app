/**
 * Post-expiry mail (a-renewal-pack-1019), pure rules.
 *
 * One mail on day 1 after a paid one-time pass ends (Vienna calendar days;
 * days 2 and 3 only catch up a missed or failed run): progress saved, the free
 * sample stays, the plans are at /pricing. No price, no date besides the end,
 * no offer. Until now nothing reached a learner after the end, and the 07:00
 * UTC expiry sweep removes the in-app lapsed banner within the day.
 *
 * Mail class: marketing (it points to the plans), so it obeys the
 * do-not-email list, carries the Stopp line and the L0 cap (at most one
 * marketing mail per learner per 14 days, read by loadMarketingCapHits). Its
 * claim sits under the "mail_reminder" provider with the user id, so every
 * later sender's cap read sees it.
 *
 * Never for: an account with access now or a newer purchase (rebought), a
 * plan that renews by itself (that end is a cancellation or a failed charge,
 * the dunning path's), a free, manual or trial grant, staff and test
 * accounts, banned or excluded accounts, or the learner's own sitting week.
 */
import { classifySubscriptionCadence } from "@/lib/billing-cadence";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { effectiveAccessEnd } from "@/lib/reminders/access-ending";
import { viennaDay, viennaDaysBetween } from "@/lib/renewal-notice/rules";

/** One-time pass tiers whose end this mail follows (v1 one-time 19/49, the Exam Cohort, the v2 Sitting Pass). */
export const ACCESS_ENDED_TIERS: readonly string[] = ["first_month_19", "first_3mo_27", "premium_pass_guaranteed", "sitting_pass"];
/** Payment rails that sold a pass; manual, staff and trial grants are not purchases. */
export const PAID_PROVIDERS: readonly string[] = ["whop", "nowpayments"];
/** Day 1 after the end is the target; days 2 and 3 only catch up. */
export const FIRST_DAY_AFTER = 1;
export const LAST_DAY_AFTER = 3;
/** Ended rows read per run (the population is small; this bounds a bad day). */
export const MAX_ENDED_ROWS = 200;

export const ACCESS_ENDED_CLAIM_PROVIDER = "mail_reminder";
export const ACCESS_ENDED_SENT = "access_ended_email_sent";

export function accessEndedClaimKey(userId: string, endMs: number): string {
  return `access_ended:${userId}:${viennaDay(endMs)}`;
}

export interface EndedRow {
  id: string;
  tier: string;
  status: string;
  payment_provider: string | null;
  provider_payment_id: string | null;
  amount_cents: number | null;
  expires_at: string;
  /** Whop plan id of the row's payment (payment_events), when logged. */
  plan_id: string | null;
}

/** A paid one-time pass row: the population of this mail. */
export function isPaidPass(row: EndedRow): boolean {
  if (!ACCESS_ENDED_TIERS.includes(row.tier)) return false;
  if (!row.payment_provider || !PAID_PROVIDERS.includes(row.payment_provider)) return false;
  if (!row.provider_payment_id) return false;
  if (row.amount_cents !== null && row.amount_cents <= 0) return false;
  // The v1 tier keys are shared by one-time and renewing Whop plans: only a known one-time plan passes (fail closed).
  return classifySubscriptionCadence({ tier: row.tier, payment_provider: row.payment_provider, plan_id: row.plan_id }) === "one_time";
}

export interface LearnerAccount {
  id: string;
  email: string | null;
  role: string | null;
  tier: string | null;
  tier_expires_at: string | null;
  is_banned: boolean | null;
}

export interface OtherRow {
  id: string;
  status: string;
  expires_at: string | null;
  created_at: string | null;
}

export type AccessEndedSkip =
  | "no_user" | "excluded" | "staff" | "banned" | "has_access" | "rebought" | "not_in_window" | "no_email" | "already_claimed";
export type AccessEndedHold = "mail_cap" | "cap_unreadable" | "sitting_week";
export type AccessEndedDecision =
  | { act: "skip"; reason: AccessEndedSkip }
  | { act: "hold"; reason: AccessEndedHold }
  | { act: "send"; daysAfter: number };

export interface DecideInput {
  account: LearnerAccount | null;
  /** End of the learner's latest ended paid pass. */
  endMs: number;
  /** Every subscription row of the learner except the ended passes themselves. */
  otherRows: OtherRow[];
  claimed: boolean;
  /** true: a marketing mail inside the 14-day cap; null: the cap could not be read. */
  capHit: boolean | null;
  sittingWeek: boolean;
  excluded: ReadonlySet<string>;
  nowMs: number;
}

/** Pure decision for one learner. Order matters: the first failing rule wins. */
export function decideAccessEnded(i: DecideInput): AccessEndedDecision {
  const a = i.account;
  if (!a) return { act: "skip", reason: "no_user" };
  if (i.excluded.has(a.id.toLowerCase())) return { act: "skip", reason: "excluded" };
  if (isStaffOrTestAccount({ role: a.role, tier: a.tier, email: a.email })) return { act: "skip", reason: "staff" };
  if (a.is_banned === true) return { act: "skip", reason: "banned" };
  if (effectiveAccessEnd(a, i.nowMs).kind !== "none") return { act: "skip", reason: "has_access" };
  for (const r of i.otherRows) {
    const end = r.expires_at ? Date.parse(r.expires_at) : NaN;
    if (r.status === "active" && (!r.expires_at || end > i.nowMs)) return { act: "skip", reason: "has_access" };
    const created = r.created_at ? Date.parse(r.created_at) : NaN;
    if (Number.isFinite(created) && created > i.endMs) return { act: "skip", reason: "rebought" };
  }
  const daysAfter = viennaDaysBetween(i.endMs, i.nowMs);
  if (i.endMs >= i.nowMs || daysAfter < FIRST_DAY_AFTER || daysAfter > LAST_DAY_AFTER) return { act: "skip", reason: "not_in_window" };
  if (!a.email || a.email.trim().length === 0) return { act: "skip", reason: "no_email" };
  if (i.claimed) return { act: "skip", reason: "already_claimed" };
  if (i.sittingWeek) return { act: "hold", reason: "sitting_week" };
  if (i.capHit === null) return { act: "hold", reason: "cap_unreadable" };
  if (i.capHit) return { act: "hold", reason: "mail_cap" };
  return { act: "send", daysAfter };
}
