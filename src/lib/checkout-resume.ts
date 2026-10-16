/**
 * Checkout resume (a-checkout-resume). Pure decision rules for the Home card
 * that takes a learner back to a checkout they opened and never paid.
 *
 * Who sees it: a signed-in learner with a `checkout_session_created` row for a
 * paid plan in the last 14 days and no `grant_succeeded` since that opener.
 * Who never sees it: current payers, comps, admins and staff or test
 * accounts, learners on the do-not-contact list, accounts track-A listed as
 * not chargeable (CHECKOUT_RESUME_EXCLUDE_USER_IDS), a checkout that is still
 * settling (pendingCheckout) and anyone while the flag is off.
 *
 * The plan fit re-checks the opened plan against the learner's own saved
 * sitting date with the shared plan-cover logic and names a cheaper plan only
 * when it covers the same time for less. No urgency, scarcity or price-change
 * wording lives here or in the copy.
 */
import { COVER_PLANS, coverUntil, daysUntil, type CoverPlan } from "@/lib/plan-cover";
import { pendingCheckout, type CheckoutEvent } from "@/lib/checkout-pending";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";

export const RESUME_WINDOW_DAYS = 14;
export const RESUME_WINDOW_MS = RESUME_WINDOW_DAYS * 86_400_000;

export function checkoutResumeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.CHECKOUT_RESUME_ENABLED !== "true") return false;
  // release-int-4 (reviewer P2-3): the card knows only the v1 plans (plan-cover);
  // with the v2 offer on it would name plans the checkout refuses, so it stays off.
  return !(env === process.env ? pricingV2Enabled() : pricingV2Enabled(env));
}

/** User ids track-A closed as not chargeable (for example a sanctions case). Empty by default. */
export function resumeExcludedIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.CHECKOUT_RESUME_EXCLUDE_USER_IDS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export type ResumeEvent = CheckoutEvent & { event: string };

export interface ResumeAccount {
  id: string;
  role?: string | null;
  tier?: string | null;
  email?: string | null;
  /** The learner's own saved sitting date (YYYY-MM-DD), if any. */
  examDate?: string | null;
  /** isPaidAccess(): admin, or a paid tier that has not expired. */
  paidAccess: boolean;
  doNotContact: boolean;
  /** A refunded or revoked subscription row exists: this learner has already paid once and been returned. */
  refunded?: boolean;
}

export type ResumeHide =
  | "flag_off" | "excluded" | "staff" | "paid" | "do_not_contact" | "no_opener" | "granted_since" | "pending" | "unpaid_plan" | "unresolved_payment" | "refunded";

export interface ResumeFit {
  /** Months until the saved sitting, for "N Monate bis zu Ihrem Termin". */
  months: number;
  openedTotalCents: number;
  /** A plan that covers the same time for less, else null. */
  cheaperTier: CoverPlan | null;
  cheaperTotalCents: number | null;
}

export type ResumeDecision =
  | { show: false; reason: ResumeHide }
  | { show: true; tier: CoverPlan; openedAt: string; fit: ResumeFit | null };

const PAID = new Set<string>(COVER_PLANS);

export function planFit(opened: CoverPlan, sittingIso: string | null | undefined, now: Date): ResumeFit | null {
  if (!sittingIso) return null;
  const cover = coverUntil(sittingIso, now);
  if (!cover) return null;
  const mine = cover.covers.find((c) => c.plan === opened);
  if (!mine) return null;
  // The Cohort carries the guarantee and is one payment, so it is never "downgraded" to a renewing plan.
  const better = opened === "premium_pass_guaranteed" ? undefined : cover.covers
    .filter((c) => c.plan !== opened && c.totalCents < mine.totalCents)
    .sort((a, b) => a.totalCents - b.totalCents || a.payments - b.payments)[0];
  return {
    months: cover.months,
    openedTotalCents: mine.totalCents,
    cheaperTier: better?.plan ?? null,
    cheaperTotalCents: better?.totalCents ?? null,
  };
}

export function decideCheckoutResume(input: {
  enabled: boolean;
  excluded: ReadonlySet<string>;
  account: ResumeAccount;
  events: readonly ResumeEvent[];
  now?: Date;
}): ResumeDecision {
  const now = input.now ?? new Date();
  const { account } = input;
  if (!input.enabled) return { show: false, reason: "flag_off" };
  if (input.excluded.has(account.id.toLowerCase())) return { show: false, reason: "excluded" };
  if (isStaffOrTestAccount({ role: account.role ?? null, tier: account.tier ?? null, email: account.email ?? null })) return { show: false, reason: "staff" };
  if (account.paidAccess) return { show: false, reason: "paid" };
  if (account.doNotContact) return { show: false, reason: "do_not_contact" };
  if (account.refunded) return { show: false, reason: "refunded" };

  const since = now.getTime() - RESUME_WINDOW_MS;
  const sorted = [...input.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const opener = sorted.find((e) => e.event === "checkout_session_created" && Date.parse(e.created_at) >= since && Date.parse(e.created_at) <= now.getTime());
  if (!opener) return { show: false, reason: "no_opener" };
  if (sorted.some((e) => e.event === "grant_succeeded" && Date.parse(e.created_at) >= Date.parse(opener.created_at))) return { show: false, reason: "granted_since" };
  // A webhook or failed grant after the opener may be a real payment nobody has tied to the learner
  // yet (the a14 unresolved queue). "Not completed" would be false, so stay silent.
  if (sorted.some((e) => (e.event === "grant_failed" || e.event === "webhook_received") && Date.parse(e.created_at) >= Date.parse(opener.created_at))) return { show: false, reason: "unresolved_payment" };
  if (pendingCheckout(sorted, now.getTime())) return { show: false, reason: "pending" };
  const tier = opener.tier ?? "";
  if (!PAID.has(tier)) return { show: false, reason: "unpaid_plan" };

  const sitting = account.examDate && daysUntil(account.examDate, now) !== null ? account.examDate : null;
  return { show: true, tier: tier as CoverPlan, openedAt: opener.created_at, fit: planFit(tier as CoverPlan, sitting, now) };
}
