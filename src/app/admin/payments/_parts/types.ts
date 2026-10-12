// Client mirror of the /api/stats/admin/payments response. The server type
// lives with the computation in @/lib/admin/paymentFunnelMetrics; it is
// duplicated here so a server-only module never enters the client bundle.

export type HealthLevel = "alarm" | "attention" | "ok" | "quiet";

export interface MoneySplit {
  gross_cents: number;
  refunds_cents: number;
  cash_cents: number;
}

export interface MoneyMonth {
  month: string;
  paid_payments: number;
  trial_starts: number;
  gross_cents: number;
  fees_known_cents: number;
  payments_with_fee_known: number;
  refunds_cents: number;
  refunds: number;
  cash_cents: number;
}

export interface LearnerRef {
  id: string;
  label: string | null;
  staff_or_test: boolean;
}

export interface UnresolvedPaymentRow {
  payment_id: string;
  provider: string;
  currency: string;
  gross_cents: number;
  net_cents: number | null;
  paid_at: string;
  last_seen_at: string;
  plan_id: string | null;
  failure_reasons: string[];
  learner: LearnerRef | null;
  linkable_tier: string | null;
  linkable_months: number | null;
  age_days: number;
}

export interface PaymentsMetrics {
  generated_at: string;
  window_days: number;
  health: {
    level: HealthLevel;
    diagnosis: string;
    failures_24h: number;
    probes_24h: number;
    probes_7d: number;
    suspected_mismatch_7d: number;
    processed_7d: number;
    deliveries_7d: number;
    unresolved_total: number;
    unresolved_cents_by_currency: Record<string, number>;
  };
  money: {
    currency: "EUR";
    today: MoneySplit;
    month_to_date: MoneySplit;
    series_7d: number[];
    days_7d: string[];
    months: MoneyMonth[];
    lifetime_gross_cents: number;
    other_currencies: Array<{ currency: string; paid_payments: number; gross_cents: number; refunds_cents: number }>;
    refunds_without_amount: number;
    basis: string;
  };
  funnel: Array<{ key: string; label: string; count: number; rows: number; hint: string }>;
  totals: { checkout_failed: number; grant_failed: number; paid_payments: number; granted_payments: number };
  failure_reasons: Array<{ reason: string; count: number }>;
  unresolved: UnresolvedPaymentRow[];
  resolved_recent: Array<{ payment_id: string; kind: "link" | "test" | "not_ours"; reason: string; resolved_at: string; currency: string; gross_cents: number | null; learner: LearnerRef | null }>;
  resolutions_available: boolean;
  refunds_90d: {
    refunds: Array<{ refund_id: string; kind: "refund" | "dispute"; currency: string; amount_cents: number | null; refunded_at: string }>;
    refund_count: number;
    dispute_count: number;
    amount_by_currency: Record<string, number>;
    refunded_access: Array<{ subscription_id: string; learner: LearnerRef | null; tier: string | null; refunded_at: string | null; access_now: string }>;
  };
  deliveries: {
    window_days: number;
    by_provider: Array<{ provider: string; result: string; rows: number; distinct_events: number }>;
    recent: Array<{ id: string; provider: string; result: string; signature_valid: boolean | null; event_id: string | null; error: string | null; received_at: string; kind: "processed" | "duplicate" | "probe" | "mismatch" | "other" }>;
  };
  recent_events: Array<{
    id: number;
    event: string;
    provider: string;
    user_id: string | null;
    tier: string | null;
    payment_id: string | null;
    checkout_session_id: string | null;
    reason: string | null;
    signature_valid: boolean | null;
    matched: boolean | null;
    amount_cents: number | null;
    currency: string | null;
    whop_event: string | null;
    created_at: string;
  }>;
}

export function money(cents: number | null | undefined, currency = "EUR"): string {
  if (cents == null) return "unknown";
  if (currency === "EUR") {
    return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(cents / 100);
  }
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/Vienna", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}
