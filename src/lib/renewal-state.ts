/**
 * Does the learner's current plan really renew by itself? (a21 P2, 2026-10-12)
 *
 * `loadRenewalOfferSuppression` (billing-cadence.ts) fails closed for sales
 * prompts: an unknown plan suppresses the offer. That answer must not be
 * shown to the learner as "Ihr Abo verlängert sich automatisch", because an
 * unknown plan, a failed check or a plan cancelled at Whop does not renew.
 * This helper answers the learner-facing question and claims an automatic
 * renewal only when Whop itself confirms it:
 *
 *   renews   - a row on an auto-renewing plan whose Whop membership is active
 *              or trialing, not set to cancel, with a next charge date
 *   unknown  - a row on an unclassified plan, an auto-renewing row whose
 *              membership cannot be read, or any read error
 *   one_time - only one-time, non-Whop or cancelled renewing rows (nothing
 *              will charge again), or no active rows
 *
 * Read only: no grant, webhook or revoke behaviour depends on it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifySubscriptionCadence } from "@/lib/billing-cadence";
import { loadWhopBillingSnapshot, type ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";

export type RenewalState = "renews" | "unknown" | "one_time";
export type SnapshotLoader = (membershipId: string | null, tier: string) => Promise<ProviderBillingSnapshot | null>;

/** True only for a provider-confirmed membership that will charge again. */
export function snapshotRenews(snapshot: ProviderBillingSnapshot | null): boolean {
  return Boolean(
    snapshot?.provider_state_verified &&
    snapshot.billing_cadence === "auto_renews" &&
    !snapshot.cancel_at_period_end &&
    (snapshot.provider_status === "active" || snapshot.provider_status === "trialing") &&
    snapshot.next_charge_at,
  );
}

export async function loadRenewalState(
  sb: SupabaseClient,
  userId: string,
  loadSnapshot: SnapshotLoader = loadWhopBillingSnapshot,
): Promise<RenewalState> {
  try {
    const { data: subs, error } = await sb.from("subscriptions")
      .select("tier, payment_provider, provider_payment_id, whop_membership_id")
      .eq("user_id", userId).eq("status", "active");
    if (error) return "unknown";
    const rows = (subs ?? []) as Array<{ tier: string; payment_provider: string | null; provider_payment_id: string | null; whop_membership_id: string | null }>;
    if (rows.length === 0) return "one_time";

    const paymentIds = rows.filter((r) => r.payment_provider === "whop" && r.provider_payment_id).map((r) => r.provider_payment_id as string);
    const planByPayment = new Map<string, string>();
    if (paymentIds.length > 0) {
      const { data: events, error: evError } = await sb.from("payment_events")
        .select("payment_id, plan_id").in("payment_id", paymentIds).not("plan_id", "is", null);
      if (evError) return "unknown";
      for (const e of (events ?? []) as Array<{ payment_id: string; plan_id: string | null }>) {
        if (e.plan_id && !planByPayment.has(e.payment_id)) planByPayment.set(e.payment_id, e.plan_id);
      }
    }

    let unknown = false;
    for (const row of rows) {
      const cadence = classifySubscriptionCadence({
        tier: String(row.tier),
        payment_provider: row.payment_provider,
        plan_id: row.provider_payment_id ? planByPayment.get(row.provider_payment_id) ?? null : null,
      });
      if (cadence === "one_time") continue;
      if (cadence === "unknown") { unknown = true; continue; }
      const snapshot = await loadSnapshot(row.whop_membership_id ?? null, String(row.tier));
      if (snapshotRenews(snapshot)) return "renews";
      // A provider-confirmed cancellation will not charge again; anything
      // the provider did not confirm stays unknown.
      if (!(snapshot?.provider_state_verified && snapshot.cancel_at_period_end)) unknown = true;
    }
    return unknown ? "unknown" : "one_time";
  } catch {
    return "unknown";
  }
}
