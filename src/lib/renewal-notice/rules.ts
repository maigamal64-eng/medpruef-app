/**
 * Pre-charge renewal notice (a-renewal-pack-1019), pure rules.
 *
 * Every Whop membership that renews by itself (monthly, quarterly, the Pro
 * trial after its first charge, the v2 renewing plans) gets one notice about
 * three days before each charge: date, amount, how to stop it. Transactional
 * (a billing notice on an existing contract, see src/lib/mail-suppression),
 * so a "Stopp" opt-out still gets it and a bounce or complaint does not.
 *
 * The charge date and amount are Whop's own (membership renewal_period_end
 * and formatted_renewal_price, parsed by whop-subscription-snapshot.ts); the
 * ledger's expires_at lags the charge by up to two days and is never stated.
 * A membership still in its free trial is not this notice's: the first charge
 * of a card trial belongs to precharge-trial-reminder.ts.
 *
 * No staff, test or banned filter on purpose: a real charge gets its notice
 * whoever holds the account. If Whop moves the charge to another Vienna day
 * after a notice, the new day is a new claim key and a second, true notice.
 */
import type { ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";

const DAY_MS = 86_400_000;
/** The target: three Vienna calendar days before the charge day. */
export const NOTICE_DAYS_AHEAD = 3;
/** Catch-up: a missed or failed run may still send until the day before. */
export const NOTICE_MIN_DAYS_AHEAD = 1;
/**
 * Ledger rows ending inside this many days are read. A plain renewal's
 * expires_at trails the charge by up to 2 days, but a renew-early stacked row
 * (20270104090000) starts at the old coverage end while Whop bills from the
 * purchase, so its end can run a whole quarter ahead of the charge. Rows are
 * read nearest end first.
 */
export const CANDIDATE_LOOKAHEAD_DAYS = 100;
/** A membership with a notice claimed this recently is not read again (every renewing interval is 30 days or more). */
export const RECENT_CLAIM_DAYS = 7;
/** Whop reads per run (4 s timeout each; the cron has 60 s for every step). */
export const MAX_MEMBERSHIPS_PER_RUN = 15;
/** Wall-clock budget for the Whop reads of one run; the rest waits for tomorrow's run (catch-up days). */
export const WHOP_READ_BUDGET_MS = 20_000;

export const RENEWAL_NOTICE_CLAIM_PROVIDER = "renewal_notice";
export const RENEWAL_NOTICE_SENT = "renewal_notice_sent";

export type RenewalNoticeSkip =
  | "no_snapshot"
  | "trialing"
  | "not_renewing"
  | "cancelling"
  | "no_charge_date"
  | "no_amount"
  | "half_year"
  | "out_of_window";

export type RenewalNoticeDue =
  | { due: true; chargeMs: number; chargeDay: string; daysAhead: number }
  | { due: false; reason: RenewalNoticeSkip };

const viennaDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
export function viennaDay(ms: number): string {
  return viennaDayFmt.format(new Date(ms));
}
/** Whole Vienna calendar days from the day of `fromMs` to the day of `toMs`. */
export function viennaDaysBetween(fromMs: number, toMs: number): number {
  const a = Date.parse(`${viennaDay(fromMs)}T00:00:00Z`);
  const b = Date.parse(`${viennaDay(toMs)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** Is a notice due for this membership now? Order matters: the first failing rule wins. */
export function renewalNoticeDue(snapshot: ProviderBillingSnapshot | null, nowMs: number): RenewalNoticeDue {
  if (!snapshot?.provider_state_verified) return { due: false, reason: "no_snapshot" };
  if (snapshot.is_trial || snapshot.provider_status === "trialing") return { due: false, reason: "trialing" };
  if (snapshot.billing_cadence !== "auto_renews" || snapshot.provider_status !== "active") return { due: false, reason: "not_renewing" };
  if (snapshot.cancel_at_period_end) return { due: false, reason: "cancelling" };
  // The snapshot leaves the date null for a paused or stopping membership.
  const chargeMs = snapshot.next_charge_at ? Date.parse(snapshot.next_charge_at) : NaN;
  if (!Number.isFinite(chargeMs)) return { due: false, reason: "no_charge_date" };
  if (snapshot.next_charge_amount_cents == null || snapshot.next_charge_amount_cents <= 0 || !snapshot.billing_interval_days) {
    return { due: false, reason: "no_amount" };
  }
  // The v2 6-month plan stops on its own after the exam date and has its own
  // 7-day reminder (HALF_YEAR_REMINDER_EMAILS_ENABLED); this notice's line
  // "every 180 days until you cancel" would not be true for it (Lektor 19 Oct).
  if (snapshot.billing_interval_days === 180) return { due: false, reason: "half_year" };
  const daysAhead = viennaDaysBetween(nowMs, chargeMs);
  if (chargeMs <= nowMs || daysAhead < NOTICE_MIN_DAYS_AHEAD || daysAhead > NOTICE_DAYS_AHEAD) return { due: false, reason: "out_of_window" };
  return { due: true, chargeMs, chargeDay: viennaDay(chargeMs), daysAhead };
}

/** One notice per membership and charge day (a moved charge day is a new charge). */
export function renewalNoticeClaimKey(membershipId: string, chargeDay: string): string {
  return `renewal_notice:${membershipId}:${chargeDay}`;
}

/** German for German or unknown accounts; every other language reads English (the app's reviewed fallback). */
export function noticeLang(languageCode: string | null | undefined): "de" | "en" {
  const code = (languageCode ?? "").trim().toLowerCase();
  return code === "" || code.startsWith("de") ? "de" : "en";
}
