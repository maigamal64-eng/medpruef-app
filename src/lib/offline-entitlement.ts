/**
 * Who may download a whole-bank offline pack (a28-finish, track-A decision
 * 12 Oct 2026, profit): only paying plans. Everyone else downloads subject
 * packs; free accounts stay inside their free set (GET /api/offline/questions).
 *
 *   Whole bank = an admin account, or a live subscriptions row (status
 *                active, not expired) with money behind it: a positive
 *                amount or a granted payment entry with a positive amount
 *                (paid Whop plan, NOWPayments, a payment linked under
 *                Payments > Unresolved, or a manual row with an amount).
 *                Same rule as "paying" in money-rules, without the
 *                payment-rail filter. The admin Grant action writes no
 *                subscriptions row, so a learner granted Pro by hand after
 *                paying outside Whop gets subject packs until the payment is
 *                recorded on a row (release note a-a28-finish).
 *   Subject    = the EUR 0 card trial (a card trial tier at 0), the legacy
 *                no-card trial, Pro granted without a payment (referral
 *                reward, comped), and every free account.
 *
 * Pure rule plus one loader; the route enforces it on summary and chunks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveUnexpired, rowHasPositivePayment, type SubscriptionLike } from "@/lib/admin/money-rules";
import { isPaidTier } from "@/lib/free-tier";
import { CARD_TRIAL_TIERS } from "@/lib/card-trial";

export const WHOLE_BANK_PAID_ONLY = "WHOLE_BANK_PAID_ONLY";

export interface OfflineAccountLike {
  role: string;
  tier: string;
  tierExpiresAt: string | null;
}

/** True when one of the account's subscription rows is live and paid for. */
export function hasLivePaidSubscription(subs: SubscriptionLike[], now: Date): boolean {
  return subs.some((s) => isActiveUnexpired(s, now) && rowHasPositivePayment(s));
}

/** Why the whole bank is closed, so the card can say the right thing. */
export type WholeBankReason = "free" | "trial" | "no_payment";
export type WholeBankDecision = { allowed: true } | { allowed: false; reason: WholeBankReason };

const TRIAL_TIERS = new Set<string>([...CARD_TRIAL_TIERS, "notes_free_trial"]);

function isAdminAccount(account: OfflineAccountLike): boolean {
  return account.role === "admin" || account.tier === "admin";
}

export function wholeBankDecision(account: OfflineAccountLike, subs: SubscriptionLike[], now: Date): WholeBankDecision {
  if (isAdminAccount(account)) return { allowed: true };
  if (!isPaidTier(account.tier, account.tierExpiresAt)) return { allowed: false, reason: "free" };
  if (hasLivePaidSubscription(subs, now)) return { allowed: true };
  const inTrial = subs.some(
    (s) => isActiveUnexpired(s, now) && (TRIAL_TIERS.has(s.tier ?? "") || s.payment_provider === "trial"),
  );
  return { allowed: false, reason: inTrial ? "trial" : "no_payment" };
}

export function canDownloadWholeBank(account: OfflineAccountLike, subs: SubscriptionLike[], now: Date): boolean {
  return wholeBankDecision(account, subs, now).allowed;
}

/**
 * Reads the caller's active subscription rows only when the answer depends on
 * them (a non-admin account with Pro access). "unavailable" = the read failed;
 * callers fail closed for downloads and report unknown for the summary.
 */
export async function loadWholeBankRight(
  sb: SupabaseClient,
  account: OfflineAccountLike & { userId: string },
  now: Date = new Date(),
): Promise<WholeBankDecision | "unavailable"> {
  if (isAdminAccount(account)) return { allowed: true };
  if (!isPaidTier(account.tier, account.tierExpiresAt)) return { allowed: false, reason: "free" };
  const { data, error } = await sb
    .from("subscriptions")
    .select("user_id, tier, status, payment_provider, amount_cents, provider_payment_id, granted_payment_ids, expires_at")
    .eq("user_id", account.userId)
    .eq("status", "active")
    .limit(50);
  if (error) return "unavailable";
  return wholeBankDecision(account, (data ?? []) as SubscriptionLike[], now);
}
