const AMBIGUOUS_BILLING_TIER_KEYS = new Set([
  "first_month_19",
  "first_3mo_27",
]);

/**
 * Return subscription labels that do not imply billing cadence when a
 * legacy tier key is shared by one-time and recurring provider plans.
 */
export function getSubscriptionDisplayNames(
  tierKey: string,
  humanName: string,
  humanNameDe: string,
): { humanName: string; humanNameDe: string } {
  if (AMBIGUOUS_BILLING_TIER_KEYS.has(tierKey)) {
    return {
      humanName: "MedPrüf Pro access",
      humanNameDe: "MedPrüf Pro-Zugang",
    };
  }

  return { humanName, humanNameDe };
}

export type SubscriptionBillingState = "active" | "trial" | "ending" | "cancelled" | "past_due" | "refunded" | "chargeback" | "expired" | "unknown";
export interface SubscriptionCardSnapshot {
  tier: string;
  tier_human_name: string;
  tier_human_name_de: string;
  status: string;
  revocation_reason?: "refund" | "chargeback" | "unknown" | null;
  expires_at: string | null;
  days_remaining: number | null;
  access_active: boolean;
  billing_cadence: "auto_renews" | "one_time" | "unknown";
  provider_status: string | null;
  provider_state_verified: boolean;
  is_trial: boolean;
  cancel_at_period_end: boolean;
  next_charge_at: string | null;
  next_charge_amount_cents: number | null;
  billing_interval_days: number | null;
  manage_url: string | null;
  payment_provider: string | null;
}
export function subscriptionBillingState(sub: SubscriptionCardSnapshot): SubscriptionBillingState {
  if (sub.status === "refunded") return "refunded";
  if (sub.status === "chargeback" || sub.status === "disputed") return "chargeback";
  if (sub.provider_status === "past_due" || sub.status === "past_due") return "past_due";
  if (sub.cancel_at_period_end || ["cancelled", "canceled", "canceling"].includes(sub.provider_status ?? sub.status)) return "cancelled";
  if (!sub.access_active || sub.status === "expired" || sub.provider_status === "expired") return "expired";
  if (sub.is_trial) return "trial";
  if (sub.billing_cadence === "one_time" && sub.days_remaining != null && sub.days_remaining > 0 && sub.days_remaining <= 7) return "ending";
  if (sub.billing_cadence === "unknown" || !["active", "trialing", "completed"].includes(sub.provider_status ?? sub.status)) return "unknown";
  return "active";
}
/** A short product label without prices, guarantees or stale trial marketing. */
export function shortSubscriptionLabel(sub: Pick<SubscriptionCardSnapshot, "tier" | "is_trial" | "billing_cadence" | "billing_interval_days">, lang: "de" | "en"): string {
  if (sub.is_trial) return lang === "de" ? "Pro-Test" : "Pro trial";
  if (sub.tier === "premium_pass_guaranteed") return lang === "de" ? "Prüfungs-Kohorte" : "Exam Cohort";
  if (sub.billing_cadence === "auto_renews" && sub.billing_interval_days === 30) return lang === "de" ? "Monatsabo" : "Monthly plan";
  if (sub.billing_cadence === "auto_renews" && sub.billing_interval_days === 90) return lang === "de" ? "3-Monats-Abo" : "3-month plan";
  return "Pro";
}
