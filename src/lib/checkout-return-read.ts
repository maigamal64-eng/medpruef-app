/**
 * Checkout return read (a-checkout-return-read). Pure rules for the first
 * in-app page after a learner left for Whop and came back without paying.
 *
 * 7 of 12 unpaid openers left Whop with no card and no reason, and the one-tap
 * stall prompt collected 2 answers in 3 months because it waited for a Home
 * slot and logged no shown event. This module decides when a return is
 * recorded (`checkout_return`) and when the existing prompt may show on
 * /pricing. Default off (CHECKOUT_RETURN_READ_ENABLED). Exclusions are those
 * of a-checkout-resume: current payers, admins, staff and test accounts, the
 * do-not-contact list, refunded payers, ids track-A closed, the EUR 0 trial
 * opener and a payment nobody has tied to the learner yet. A settling checkout
 * does not stop the measurement (it is what is measured); it still keeps the
 * prompt away through the existing pending check.
 */
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { resumeExcludedIds, type ResumeAccount } from "@/lib/checkout-resume";

export const RETURN_WINDOW_MS = 2 * 60 * 60_000;

export function checkoutReturnReadEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CHECKOUT_RETURN_READ_ENABLED === "true";
}

export const RETURN_BUCKETS = ["lt_1m", "1_5m", "5_30m", "30m_2h"] as const;
export type ReturnBucket = (typeof RETURN_BUCKETS)[number];

/** Seconds since the redirect, as a bucket (never a raw timestamp). */
export function returnBucket(seconds: number): ReturnBucket {
  if (seconds < 60) return "lt_1m";
  if (seconds < 5 * 60) return "1_5m";
  if (seconds < 30 * 60) return "5_30m";
  return "30m_2h";
}

export type ReturnEvent = { event: string; created_at: string; tier?: string | null };

export type ReturnHide =
  | "flag_off" | "excluded" | "staff" | "paid" | "do_not_contact" | "refunded"
  | "no_redirect" | "granted_since" | "unresolved_payment" | "unpaid_plan";

export type ReturnDecision =
  | { show: false; reason: ReturnHide }
  | { show: true; tier: string; seconds: number; bucket: ReturnBucket; redirectedAt: string };

export function decideCheckoutReturn(input: {
  enabled: boolean;
  excluded: ReadonlySet<string>;
  account: ResumeAccount;
  events: readonly ReturnEvent[];
  now?: Date;
}): ReturnDecision {
  const now = input.now ?? new Date();
  const { account } = input;
  if (!input.enabled) return { show: false, reason: "flag_off" };
  if (input.excluded.has(account.id.toLowerCase())) return { show: false, reason: "excluded" };
  if (isStaffOrTestAccount({ role: account.role ?? null, tier: account.tier ?? null, email: account.email ?? null })) return { show: false, reason: "staff" };
  if (account.paidAccess) return { show: false, reason: "paid" };
  if (account.doNotContact) return { show: false, reason: "do_not_contact" };
  if (account.refunded) return { show: false, reason: "refunded" };

  const t = now.getTime();
  const sorted = [...input.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const redirect = sorted.find((e) => e.event === "checkout_redirected" && Date.parse(e.created_at) <= t && t - Date.parse(e.created_at) <= RETURN_WINDOW_MS);
  if (!redirect) return { show: false, reason: "no_redirect" };
  const at = Date.parse(redirect.created_at);
  if (sorted.some((e) => e.event === "grant_succeeded" && Date.parse(e.created_at) >= at)) return { show: false, reason: "granted_since" };
  // A webhook or failed grant after the redirect may be a real payment nobody has tied to the learner yet.
  if (sorted.some((e) => (e.event === "grant_failed" || e.event === "webhook_received") && Date.parse(e.created_at) >= at)) return { show: false, reason: "unresolved_payment" };
  // The EUR 0 trial opener and a mentor checkout (no plan tier) are not unpaid plan openers.
  const tier = redirect.tier ?? "";
  if (!tier || tier === "notes_pro_trial") return { show: false, reason: "unpaid_plan" };
  const seconds = Math.max(0, Math.round((t - at) / 1000));
  return { show: true, tier, seconds, bucket: returnBucket(seconds), redirectedAt: redirect.created_at };
}

export { resumeExcludedIds };
