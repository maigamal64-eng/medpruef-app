/**
 * paymentFunnelMetrics — the read-only data behind /admin/payments.
 *
 * Rebuilt 2026-10-12 (a14, ADM-02 option A + ADM-01 option A):
 *  - The headline diagnosis comes from computePaymentHealth in
 *    ./money-rules, the same function the Overview "Payment failures (24h)"
 *    tile reads, so the two can never disagree. The ALARM fires only when,
 *    in the last 7 days, signed-looking Whop deliveries were rejected and
 *    nothing processed. Unsigned probes ("no recognized auth header") are a
 *    neutral count, never red.
 *  - Money in per Vienna month on the cash basis (computeMoneyIn), gross,
 *    with Whop fees and net only where Whop reported both amounts (OW-31:
 *    a 17.72 row is Whop net on a 19.00 charge, not a discount).
 *  - The funnel counts distinct checkout sessions and distinct payments,
 *    not log rows (one payment can carry 14 repeated deliveries).
 *  - Unresolved payments (paid, never granted, not resolved) never age out.
 *    Refunds are their own 90-day line with the access outcome.
 *  - The deliveries section absorbs the former /admin/webhooks page.
 *
 * READ-ONLY: every query is a SELECT. Imported only by the admin-shelled API
 * route, never by the client page (which mirrors the TYPES only).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertReadSucceeded } from "./read-result";
import { loadAccounts, loadLedger, loadWhopDeliveries, readAll } from "./moneyMetrics";
import {
  computeMoneyIn,
  computePaymentHealth,
  countsAsMoneyIn,
  isStaffOrTestAccount,
  isUnresolvedPayment,
  isUnsignedProbe,
  isSuspectedSecretMismatch,
  type HealthLevel,
  type LedgerPayment,
  type MoneyIn,
} from "./money-rules";
import { whopPlanToTier, tierDurationMonths } from "@/lib/whop";

export interface FunnelStep {
  key: string;
  label: string;
  /** Distinct sessions / payments, the number to read. */
  count: number;
  /** Underlying log rows, for reconciliation only. */
  rows: number;
  hint: string;
}

export interface PaymentFeedRow {
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
}

export interface WebhookDeliveryRow {
  id: string;
  provider: string;
  result: string;
  signature_valid: boolean | null;
  event_id: string | null;
  error: string | null;
  received_at: string;
  /** probe = unsigned noise; mismatch = signed-looking but rejected. */
  kind: "processed" | "duplicate" | "probe" | "mismatch" | "other";
}

export interface LearnerRef {
  id: string;
  /** Present only when the viewer also holds users.read. */
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
  /** Internal tier the plan maps to; null = not one of our Pro plans. */
  linkable_tier: string | null;
  linkable_months: number | null;
  age_days: number;
}

export interface ResolvedPaymentRow {
  payment_id: string;
  kind: "link" | "test" | "not_ours";
  reason: string;
  resolved_at: string;
  currency: string;
  gross_cents: number | null;
  learner: LearnerRef | null;
}

export interface RefundRow {
  refund_id: string;
  kind: "refund" | "dispute";
  currency: string;
  amount_cents: number | null;
  refunded_at: string;
}

export interface RefundedAccessRow {
  subscription_id: string;
  learner: LearnerRef | null;
  tier: string | null;
  refunded_at: string | null;
  /** What the learner holds now. */
  access_now: string;
}

export interface PaymentFunnelMetrics {
  generated_at: string;
  window_days: number;
  health: {
    level: HealthLevel;
    diagnosis: string;
    failures_24h: number;
    probes_24h: number;
    probes_7d: number;
    suspected_mismatch_7d: number;
    server_errors_7d: number;
    processed_7d: number;
    deliveries_7d: number;
    unresolved_total: number;
    unresolved_cents_by_currency: Record<string, number>;
  };
  money: MoneyIn;
  funnel: FunnelStep[];
  totals: {
    checkout_failed: number;
    grant_failed: number;
    paid_payments: number;
    granted_payments: number;
  };
  failure_reasons: Array<{ reason: string; count: number }>;
  unresolved: UnresolvedPaymentRow[];
  resolved_recent: ResolvedPaymentRow[];
  resolutions_available: boolean;
  refunds_90d: {
    refunds: RefundRow[];
    refund_count: number;
    dispute_count: number;
    amount_by_currency: Record<string, number>;
    refunded_access: RefundedAccessRow[];
  };
  deliveries: {
    window_days: number;
    by_provider: Array<{ provider: string; result: string; rows: number; distinct_events: number }>;
    recent: WebhookDeliveryRow[];
  };
  recent_events: PaymentFeedRow[];
}

const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const FEED_LIMIT = 50;
const DELIVERY_LIMIT = 25;

function deliveryKind(d: { result: string; error: string | null }): WebhookDeliveryRow["kind"] {
  if (d.result === "processed") return "processed";
  if (d.result === "dup") return "duplicate";
  if (isSuspectedSecretMismatch({ ...d, received_at: "" })) return "mismatch";
  if (isUnsignedProbe({ ...d, received_at: "" })) return "probe";
  return "other";
}

function accessNow(u: { tier?: string | null; tier_expires_at?: string | null } | undefined, now: Date): string {
  if (!u) return "Account deleted";
  if (u.tier === "admin") return "Staff account";
  if (u.tier === "pro" && !u.tier_expires_at) return "Pro, no end date";
  if (u.tier === "pro" && u.tier_expires_at && Date.parse(u.tier_expires_at) > now.getTime()) {
    return `Pro until ${u.tier_expires_at.slice(0, 10)}`;
  }
  return "Free";
}

export async function computePaymentFunnelMetrics(
  sb: SupabaseClient,
  opts: { canReadUsers?: boolean } = {},
): Promise<PaymentFunnelMetrics> {
  const now = new Date();
  const since30 = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();
  const since90 = new Date(now.getTime() - 90 * DAY_MS).toISOString();
  const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const [
    { ledger, resolutionsAvailable },
    accounts,
    whop7d,
    checkoutRes,
    failureRowsRes,
    recentRes,
    deliveries30Res,
    recentDeliveriesRes,
    refundedSubsRes,
  ] = await Promise.all([
    loadLedger(sb),
    loadAccounts(sb),
    loadWhopDeliveries(sb, since7),
    readAll<{ event: string; checkout_session_id: string | null; user_id: string | null }>((from, to) => sb
      .from("payment_events")
      .select("event, checkout_session_id, user_id")
      .in("event", ["checkout_session_created", "checkout_redirected", "checkout_failed"])
      .gte("created_at", since30)
      .order("id", { ascending: true })
      .range(from, to)),
    readAll<{ reason: string | null; event: string }>((from, to) => sb
      .from("payment_events")
      .select("reason, event")
      .in("event", ["grant_failed", "checkout_failed"])
      .gte("created_at", since30)
      .order("id", { ascending: true })
      .range(from, to)),
    sb
      .from("payment_events")
      .select("id, event, provider, user_id, tier, payment_id, checkout_session_id, reason, signature_valid, matched, amount_cents, currency, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    readAll<{ provider: string; result: string; event_id: string | null }>((from, to) => sb
      .from("webhook_attempts")
      .select("provider, result, event_id")
      .gte("received_at", since30)
      .order("id", { ascending: true })
      .range(from, to)),
    sb
      .from("webhook_attempts")
      .select("id, provider, result, signature_valid, event_id, error, received_at")
      .order("received_at", { ascending: false })
      .limit(DELIVERY_LIMIT),
    sb
      .from("subscriptions")
      .select("id, user_id, tier, cancelled_at, updated_at")
      .eq("status", "refunded")
      .gte("updated_at", since90)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);
  for (const r of [recentRes, recentDeliveriesRes, refundedSubsRes]) {
    assertReadSucceeded(r);
  }

  const users = new Map(accounts.map((a) => [a.id, a]));
  const learner = (id: string | null): LearnerRef | null => {
    if (!id) return null;
    const u = users.get(id);
    const name = u ? [u.first_name, u.last_name].filter(Boolean).join(" ").trim() : "";
    return {
      id,
      label: opts.canReadUsers && u ? (name ? `${name}${u.email ? ` (${u.email})` : ""}` : u.email ?? null) : null,
      staff_or_test: isStaffOrTestAccount(u),
    };
  };

  const health = computePaymentHealth(whop7d, ledger, now);
  const money = computeMoneyIn(ledger, now);

  // ── funnel: distinct sessions and payments ──
  const checkoutRows = checkoutRes;
  const distinct = (event: string) => {
    const rows = checkoutRows.filter((r) => r.event === event);
    const keys = new Set(rows.map((r, i) => r.checkout_session_id ?? `row:${event}:${i}`));
    return { count: keys.size, rows: rows.length, buyers: new Set(rows.map((r) => r.user_id).filter(Boolean)).size };
  };
  const created = distinct("checkout_session_created");
  const redirected = distinct("checkout_redirected");
  const failedCheckouts = distinct("checkout_failed");
  const paidInWindow = ledger.payments.filter((p) => Date.parse(p.paid_at) >= Date.parse(since30) && countsAsMoneyIn(p));
  const grantedInWindow = paidInWindow.filter((p) => p.granted);
  const funnel: FunnelStep[] = [
    { key: "checkout_session_created", label: "Checkout started", count: created.count, rows: created.rows, hint: `${created.buyers} distinct buyer${created.buyers === 1 ? "" : "s"}` },
    { key: "checkout_redirected", label: "Redirected to pay", count: redirected.count, rows: redirected.rows, hint: "distinct checkout sessions" },
    { key: "payment_received", label: "Paid", count: paidInWindow.length, rows: paidInWindow.length, hint: "distinct paid payments" },
    { key: "grant_succeeded", label: "Pro granted", count: grantedInWindow.length, rows: grantedInWindow.length, hint: "paid payments that granted" },
  ];

  const reasonCounts = new Map<string, number>();
  let grantFailedRows = 0;
  for (const r of failureRowsRes) {
    if (r.event === "grant_failed") grantFailedRows += 1;
    const key = r.reason ?? "(unspecified)";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }

  // ── unresolved queue (never ages out) ──
  const unresolved: UnresolvedPaymentRow[] = ledger.payments.filter(isUnresolvedPayment).map((p: LedgerPayment) => {
    const tier = p.provider === "whop" ? whopPlanToTier(p.plan_id) : null;
    return {
      payment_id: p.payment_id,
      provider: p.provider,
      currency: p.currency,
      gross_cents: p.gross_cents as number,
      net_cents: p.net_cents,
      paid_at: p.paid_at,
      last_seen_at: p.last_seen_at,
      plan_id: p.plan_id,
      failure_reasons: p.failure_reasons,
      learner: learner(p.user_id),
      linkable_tier: tier,
      linkable_months: tier ? tierDurationMonths(tier) : null,
      age_days: Math.floor((now.getTime() - Date.parse(p.paid_at)) / DAY_MS),
    };
  });
  const resolvedRecent: ResolvedPaymentRow[] = ledger.payments
    .filter((p) => p.resolution && Date.parse(p.resolution.created_at) >= Date.parse(since90))
    .map((p) => ({
      payment_id: p.payment_id,
      kind: p.resolution!.kind,
      reason: p.resolution!.reason,
      resolved_at: p.resolution!.created_at,
      currency: p.currency,
      gross_cents: p.gross_cents,
      learner: learner(p.resolution!.user_id ?? p.user_id),
    }))
    .sort((a, b) => Date.parse(b.resolved_at) - Date.parse(a.resolved_at));

  // ── refunds (90 days) with access outcome ──
  const refunds90 = ledger.refunds.filter((r) => Date.parse(r.refunded_at) >= Date.parse(since90));
  const refundAmounts: Record<string, number> = {};
  for (const r of refunds90) {
    if (r.kind === "refund" && r.amount_cents != null) refundAmounts[r.currency] = (refundAmounts[r.currency] ?? 0) + r.amount_cents;
  }
  const refundedAccess: RefundedAccessRow[] = ((refundedSubsRes.data ?? []) as Array<{ id: string; user_id: string | null; tier: string | null; cancelled_at: string | null; updated_at: string | null }>).map((s) => ({
    subscription_id: s.id,
    learner: learner(s.user_id),
    tier: s.tier,
    refunded_at: s.cancelled_at ?? s.updated_at,
    access_now: s.user_id ? accessNow(users.get(s.user_id), now) : "No learner on the row",
  }));

  // ── deliveries (absorbs /admin/webhooks) ──
  const group = new Map<string, { provider: string; result: string; rows: number; events: Set<string> }>();
  for (const d of deliveries30Res) {
    const key = `${d.provider}:${d.result}`;
    const g = group.get(key) ?? { provider: d.provider, result: d.result, rows: 0, events: new Set<string>() };
    g.rows += 1;
    if (d.event_id) g.events.add(d.event_id);
    group.set(key, g);
  }
  const recentDeliveries = ((recentDeliveriesRes.data ?? []) as Array<Omit<WebhookDeliveryRow, "kind">>).map((d) => ({ ...d, kind: deliveryKind(d) }));

  const feed = ((recentRes.data ?? []) as Array<Omit<PaymentFeedRow, "whop_event"> & { metadata: Record<string, unknown> | null }>).map(({ metadata, ...row }) => {
    const w = metadata?.whop_event ?? metadata?.event;
    return { ...row, whop_event: typeof w === "string" ? w.slice(0, 60) : null };
  });

  return {
    generated_at: now.toISOString(),
    window_days: WINDOW_DAYS,
    health: {
      level: health.level,
      diagnosis: health.diagnosis,
      failures_24h: health.failures_24h,
      probes_24h: health.probes_24h,
      probes_7d: health.probes_7d,
      suspected_mismatch_7d: health.suspected_mismatch_7d,
      server_errors_7d: health.server_errors_7d,
      processed_7d: health.processed_7d,
      deliveries_7d: health.deliveries_7d,
      unresolved_total: health.unresolved_total,
      unresolved_cents_by_currency: health.unresolved_cents_by_currency,
    },
    money,
    funnel,
    totals: {
      checkout_failed: failedCheckouts.count,
      grant_failed: grantFailedRows,
      paid_payments: paidInWindow.length,
      granted_payments: grantedInWindow.length,
    },
    failure_reasons: [...reasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    unresolved,
    resolved_recent: resolvedRecent,
    resolutions_available: resolutionsAvailable,
    refunds_90d: {
      refunds: refunds90,
      refund_count: refunds90.filter((r) => r.kind === "refund").length,
      dispute_count: refunds90.filter((r) => r.kind === "dispute").length,
      amount_by_currency: refundAmounts,
      refunded_access: refundedAccess,
    },
    deliveries: {
      window_days: WINDOW_DAYS,
      by_provider: [...group.values()]
        .map((g) => ({ provider: g.provider, result: g.result, rows: g.rows, distinct_events: g.events.size }))
        .sort((a, b) => b.rows - a.rows),
      recent: recentDeliveries,
    },
    recent_events: feed,
  };
}
