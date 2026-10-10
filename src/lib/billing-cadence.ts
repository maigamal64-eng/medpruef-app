/**
 * Billing cadence: does this user already hold a plan that renews by itself?
 *
 * Why it exists (audit card i-MP-TRUTH-19, approved 2026-10-10): the
 * site-wide renewal banner and the reminder cron both offered the 49 EUR
 * 3-month plan to anyone near their end date. For a user whose plan renews
 * automatically (the Pro trial that converts to 19 EUR/month, or the
 * recurring monthly/quarterly plans), one click stacked a second
 * subscription on top of the first.
 *
 * Signals, cheapest first:
 *   1. tier `notes_pro_trial` is the Whop renewal plan by definition.
 *   2. Otherwise the Whop plan id logged for the row's latest payment in
 *      `payment_events.plan_id`, checked against AUTO_RENEWING_WHOP_PLAN_IDS
 *      (owned by src/lib/billing-copy.ts). The tier keys `first_month_19`
 *      and `first_3mo_27` are shared by one-time and recurring plans, so the
 *      key alone cannot answer this (see subscription-display.ts).
 *
 * Rule (fail closed for a sales prompt):
 *   - any active row that auto-renews        -> suppress the offer
 *   - any active Whop row whose plan is unknown -> suppress the offer
 *   - no active rows, or only one-time / non-Whop rows -> offer allowed
 * Known gap: a user who cancelled a recurring plan at Whop keeps an active
 * row until it ends, so they are also not offered a renewal.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTO_RENEWING_WHOP_PLAN_IDS } from "@/lib/billing-copy";

/** Tiers that only exist on an auto-renewing Whop plan. */
export const AUTO_RENEWING_TIERS: ReadonlySet<string> = new Set(["notes_pro_trial"]);

export type BillingCadence = "auto_renews" | "one_time" | "unknown";

export interface CadenceRow {
  tier: string;
  payment_provider: string | null;
  /** Whop plan id of the row's latest payment, when logged. */
  plan_id: string | null;
}

export function classifySubscriptionCadence(row: CadenceRow): BillingCadence {
  if (AUTO_RENEWING_TIERS.has(row.tier)) return "auto_renews";
  // Crypto, manual and trial grants never auto-charge.
  if (row.payment_provider !== "whop") return "one_time";
  const plan = row.plan_id?.trim();
  if (!plan) return "unknown";
  return AUTO_RENEWING_WHOP_PLAN_IDS.has(plan) ? "auto_renews" : "one_time";
}

/** True when a renewal / second-plan offer must NOT be shown. */
export function shouldSuppressRenewalOffer(rows: CadenceRow[]): boolean {
  return rows.some((r) => classifySubscriptionCadence(r) !== "one_time");
}

/**
 * Load the user's active subscription rows with their logged Whop plan id
 * and apply the rule above. Throws on any read error; callers treat a
 * throw as "suppress" (never sell when we cannot tell).
 */
export async function loadRenewalOfferSuppression(
  sb: SupabaseClient,
  userId: string,
): Promise<{ suppressed: boolean; rows: CadenceRow[] }> {
  const { data: subs, error } = await sb
    .from("subscriptions")
    .select("tier, payment_provider, provider_payment_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;

  const active = (subs ?? []) as Array<{
    tier: string;
    payment_provider: string | null;
    provider_payment_id: string | null;
  }>;

  // Only Whop rows on a shared tier key need the plan id.
  const needPlan = active
    .filter((s) => s.payment_provider === "whop" && !AUTO_RENEWING_TIERS.has(String(s.tier)))
    .map((s) => s.provider_payment_id)
    .filter((id): id is string => Boolean(id));

  const planByPayment = new Map<string, string>();
  if (needPlan.length > 0) {
    const { data: events, error: evError } = await sb
      .from("payment_events")
      .select("payment_id, plan_id")
      .in("payment_id", needPlan)
      .not("plan_id", "is", null);
    if (evError) throw evError;
    for (const e of (events ?? []) as Array<{ payment_id: string; plan_id: string | null }>) {
      if (e.plan_id && !planByPayment.has(e.payment_id)) planByPayment.set(e.payment_id, e.plan_id);
    }
  }

  const rows: CadenceRow[] = active.map((s) => ({
    tier: String(s.tier),
    payment_provider: s.payment_provider,
    plan_id: s.provider_payment_id ? planByPayment.get(s.provider_payment_id) ?? null : null,
  }));
  return { suppressed: shouldSuppressRenewalOffer(rows), rows };
}
