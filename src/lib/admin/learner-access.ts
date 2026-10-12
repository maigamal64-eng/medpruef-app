/**
 * learner-access: the Access strip and the paid verdict on the admin learner
 * page (ADM-07 option A, pick-admin-07).
 *
 *   Paid     = a subscription row with a positive amount AND a payment
 *              reference (provider payment id, a granted payment entry or a
 *              crypto transaction hash), not pending or failed. An unpaid
 *              crypto invoice that was later cancelled is never "paid"
 *              (two learners showed "Payer, EUR 114 lifetime" from those).
 *              Refunded rows are counted apart, never as paid.
 *   Access   = where the learner's current Pro window comes from:
 *              a subscription row whose end matches users.tier_expires_at,
 *              an audited admin grant whose new expiry matches it, or
 *              "Set outside admin" when neither explains it.
 *
 * Pure: the route loads rows, this file classifies them. Never sums two
 * currencies together.
 */

import { durationLabel } from "@/lib/admin/money-rules";
import { classifySubscriptionCadence, type BillingCadence } from "@/lib/billing-cadence";

export interface LearnerSubscriptionRow {
  tier: string | null;
  status: string | null;
  payment_provider: string | null;
  payment_method?: string | null;
  amount_cents: number | null;
  currency?: string | null;
  provider_payment_id?: string | null;
  crypto_tx_hash?: string | null;
  granted_payment_ids?: Array<{ payment_id?: string | null; amount_cents?: number | null }> | null;
  started_at?: string | null;
  expires_at: string | null;
  created_at?: string | null;
  /** Whop plan id of the row's latest payment, when logged. */
  plan_id?: string | null;
}

const NOT_PAID_STATUSES = new Set(["pending", "failed"]);
const REFUND_STATUSES = new Set(["refunded"]);

function grantedEntries(s: LearnerSubscriptionRow) {
  return (Array.isArray(s.granted_payment_ids) ? s.granted_payment_ids : []).filter(
    (e) => e && typeof e.payment_id === "string" && e.payment_id.length > 0,
  );
}

export function hasPaymentReference(s: LearnerSubscriptionRow): boolean {
  if (s.provider_payment_id) return true;
  if (s.crypto_tx_hash) return true;
  return grantedEntries(s).length > 0;
}

/** Money that actually changed hands on this row, in its currency. */
export function rowPaidCents(s: LearnerSubscriptionRow): number {
  if (NOT_PAID_STATUSES.has(s.status ?? "")) return 0;
  if (!hasPaymentReference(s)) return 0;
  const entries = grantedEntries(s);
  const fromEntries = entries.reduce((sum, e) => sum + Math.max(0, e.amount_cents ?? 0), 0);
  if (fromEntries > 0) return fromEntries;
  return Math.max(0, s.amount_cents ?? 0);
}

export interface LearnerMoneyVerdict {
  isPayer: boolean;
  /** Paid per currency (upper-case code), refunds excluded. */
  paidByCurrency: Record<string, number>;
  refundedByCurrency: Record<string, number>;
  /** Rows with an amount but no payment reference (unpaid invoices). */
  unpaidInvoiceRows: number;
}

export const PAID_BASIS =
  "Paid counts only subscription rows with a payment reference (Whop or NOWPayments payment id, a granted payment entry or a crypto transaction hash). Unpaid invoices and refunded rows are not paid.";

export function learnerMoneyVerdict(subs: LearnerSubscriptionRow[]): LearnerMoneyVerdict {
  const paid: Record<string, number> = {};
  const refunded: Record<string, number> = {};
  let unpaid = 0;
  for (const s of subs) {
    const currency = (s.currency || "EUR").toUpperCase();
    const cents = rowPaidCents(s);
    if (cents <= 0) {
      if ((s.amount_cents ?? 0) > 0 && !hasPaymentReference(s)) unpaid += 1;
      continue;
    }
    if (REFUND_STATUSES.has(s.status ?? "")) refunded[currency] = (refunded[currency] ?? 0) + cents;
    else paid[currency] = (paid[currency] ?? 0) + cents;
  }
  return {
    isPayer: Object.values(paid).some((v) => v > 0),
    paidByCurrency: paid,
    refundedByCurrency: refunded,
    unpaidInvoiceRows: unpaid,
  };
}

// ── Access strip ────────────────────────────────────────────────────────

export interface AdminGrantRow {
  actor_email: string | null;
  created_at: string;
  days: number | null;
  reason: string | null;
  new_expiry: string | null;
}

export interface LearnerAccessInput {
  tier: string | null;
  tier_expires_at: string | null;
  role: string | null;
  subscriptions: LearnerSubscriptionRow[];
  /** Newest audited grants (grant_free_access), newest first. */
  grants: AdminGrantRow[];
  /** Months a tier key grants; injected so this file stays dependency-free. */
  monthsForTier: (tier: string) => number | null;
}

export type AccessState = "pro" | "pro_no_end" | "ended" | "free" | "admin_account";
export type AccessSource = "subscription" | "admin_grant" | "outside_admin" | "none";

export interface LearnerAccess {
  state: AccessState;
  /** End of the current Pro window, ISO, when known. */
  endsAt: string | null;
  source: AccessSource;
  /** One plain line under the name, e.g. "Whop, 1 month, renews". */
  sourceLabel: string;
  renewal: BillingCadence | null;
  provider: string | null;
  grant: AdminGrantRow | null;
}

const MATCH_MS = 60_000;
const PROVIDER_LABEL: Record<string, string> = {
  whop: "Whop",
  nowpayments: "NOWPayments (crypto)",
  stripe: "Stripe",
  manual: "Manual record",
  trial: "Trial record",
};

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= MATCH_MS;
}

function renewalWords(c: BillingCadence): string {
  return c === "auto_renews" ? "renews" : c === "one_time" ? "does not renew" : "renewal not known";
}

export function describeLearnerAccess(input: LearnerAccessInput, now: Date): LearnerAccess {
  const base = { renewal: null, provider: null, grant: null } as const;
  if (input.role === "admin" || input.tier === "admin") {
    return { ...base, state: "admin_account", endsAt: null, source: "none", sourceLabel: "Admin account" };
  }
  const tier = input.tier ?? "free";
  const end = input.tier_expires_at;
  const endMs = end ? Date.parse(end) : null;
  if (tier === "free") {
    return { ...base, state: "free", endsAt: null, source: "none", sourceLabel: "No Pro access" };
  }
  if (endMs !== null && Number.isFinite(endMs) && endMs <= now.getTime()) {
    return { ...base, state: "ended", endsAt: end, source: "none", sourceLabel: `${tier} ended` };
  }

  const active = input.subscriptions.filter(
    (s) => s.status === "active" && (!s.expires_at || Date.parse(s.expires_at) > now.getTime()),
  );
  const match = end
    ? active.find((s) => sameInstant(s.expires_at, end))
    : active.find((s) => !s.expires_at);
  const state: AccessState = end ? "pro" : "pro_no_end";
  if (match) {
    const cadence = classifySubscriptionCadence({ tier: match.tier ?? "", payment_provider: match.payment_provider, plan_id: match.plan_id ?? null });
    const provider = match.payment_provider ?? "unknown";
    const plan = durationLabel(match.tier ? input.monthsForTier(match.tier) : null, match.tier);
    return {
      state,
      endsAt: end,
      source: "subscription",
      sourceLabel: `${PROVIDER_LABEL[provider] ?? provider}, ${plan}, ${renewalWords(cadence)}`,
      renewal: cadence,
      provider,
      grant: null,
    };
  }
  const grant = end ? input.grants.find((g) => sameInstant(g.new_expiry, end)) ?? null : null;
  if (grant) {
    return {
      state,
      endsAt: end,
      source: "admin_grant",
      sourceLabel: `Admin grant${grant.actor_email ? ` by ${grant.actor_email}` : ""}${grant.days ? `, ${grant.days} days` : ""}`,
      renewal: "one_time",
      provider: null,
      grant,
    };
  }
  return {
    ...base,
    state,
    endsAt: end,
    source: "outside_admin",
    sourceLabel: "Set outside admin: no subscription or audited grant matches this end date",
  };
}
