/**
 * Returning-payer prices (decision returning-payer-price, fast-money D-A,
 * 15 Oct 2026; review 12 Nov). A learner with a succeeded Whop payment may
 * also book the two old recurring plans (19 EUR monthly, 49 EUR every
 * 3 months; never the retired one-time Cohort), next to the v2 offer.
 *
 * Channels: in-app only (/pricing and the renewal surface, signed in) and the
 * learner's own access-ending mail. Never a public page, JSON-LD, llms.txt or
 * a broadcast. No deadline in copy.
 *
 * Switch: RETURNING_PAYER_PRICES_ENABLED (runtime, default OFF), only with
 * PRICING_V2_ENABLED on (before the flip the old plans are on sale anyway).
 * Read at request time, so turning it off after the 12 Nov review needs no
 * redeploy and checkout, /pricing and the mail always agree.
 *
 * Eligibility: at least one Whop subscriptions row with a positive payment
 * (row amount or a granted_payment_ids entry above zero) that was not
 * refunded or charged back. A EUR 0 card trial, the reverse trial, manual
 * grants and the renewal guard's free extension never qualify; a learner
 * whose every Whop payment was refunded does not either. A failed read
 * throws: callers fail closed (no old price shown, checkout 503).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pricingV2Enabled } from "./flag";
import { isReturningTier } from "./price-facts";

type Env = Record<string, string | undefined>;

export function returningPricesEnabled(env?: Env): boolean {
  const e = env ?? process.env;
  return (env ? pricingV2Enabled(env) : pricingV2Enabled()) && e.RETURNING_PAYER_PRICES_ENABLED === "true";
}

const REVERSED = new Set(["refunded", "chargeback", "disputed"]);

interface PaidRowLike {
  status: string | null;
  amount_cents: number | null;
  granted_payment_ids: unknown;
}

/** Pure: does one of these Whop rows prove a succeeded payment? */
export function hasSucceededWhopPayment(rows: readonly PaidRowLike[]): boolean {
  return rows.some((r) => {
    if (REVERSED.has(String(r.status ?? ""))) return false;
    if ((r.amount_cents ?? 0) > 0) return true;
    const entries = Array.isArray(r.granted_payment_ids) ? r.granted_payment_ids : [];
    return entries.some((e) => Number((e as { amount_cents?: unknown } | null)?.amount_cents ?? 0) > 0);
  });
}

export async function isReturningPayer(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await sb.from("subscriptions")
    .select("status, amount_cents, granted_payment_ids")
    .eq("user_id", userId).eq("payment_provider", "whop").limit(200);
  if (error) throw error;
  return hasSucceededWhopPayment((data ?? []) as PaidRowLike[]);
}

/** May this checkout sell a returning-payer plan? Throws on a failed read. */
export async function returningCheckoutAllowed(sb: SupabaseClient, userId: string, tier: unknown): Promise<boolean> {
  if (!isReturningTier(tier) || !returningPricesEnabled()) return false;
  return isReturningPayer(sb, userId);
}
