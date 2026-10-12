/**
 * Who may download a whole-bank offline pack (a28-finish, track-A decision
 * 12 Oct 2026, profit): only paying plans. Everyone else downloads subject
 * packs; free accounts stay inside their free set (GET /api/offline/questions).
 *
 *   Whole bank = an admin account, or a live subscriptions row (status
 *                active, not expired) with money behind it: a positive
 *                amount or a granted payment entry with a positive amount
 *                (paid Whop plan, NOWPayments, a manual grant that recorded
 *                a payment). Same rule as "paying" in money-rules, without
 *                the payment-rail filter so a manual paid grant counts.
 *   Subject    = the EUR 0 card trial (notes_pro_trial at 0), the legacy
 *                no-card trial, Pro granted without a payment (referral
 *                reward, comped), and every free account.
 *
 * Pure rule plus one loader; the route enforces it on summary and chunks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isActiveUnexpired, rowHasPositivePayment, type SubscriptionLike } from "@/lib/admin/money-rules";
import { isPaidTier } from "@/lib/free-tier";

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

export function canDownloadWholeBank(account: OfflineAccountLike, subs: SubscriptionLike[], now: Date): boolean {
  if (account.role === "admin" || account.tier === "admin") return true;
  if (!isPaidTier(account.tier, account.tierExpiresAt)) return false;
  return hasLivePaidSubscription(subs, now);
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
): Promise<boolean | "unavailable"> {
  if (account.role === "admin" || account.tier === "admin") return true;
  if (!isPaidTier(account.tier, account.tierExpiresAt)) return false;
  const { data, error } = await sb
    .from("subscriptions")
    .select("user_id, tier, status, payment_provider, amount_cents, provider_payment_id, granted_payment_ids, expires_at")
    .eq("user_id", account.userId)
    .eq("status", "active")
    .limit(50);
  if (error) return "unavailable";
  return canDownloadWholeBank(account, (data ?? []) as SubscriptionLike[], now);
}
