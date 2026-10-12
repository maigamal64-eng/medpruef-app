/**
 * Mentor revenue next to cost (a40, MUX-98). Pure rules, server and test safe.
 *
 * Money in follows the shared admin money definition (src/lib/admin/money-rules.ts,
 * ADM-01 A): a payment counts at its gross Whop amount on its Vienna payment day,
 * per currency, never converted. A mentor payment is one whose payment_events
 * rows carry metadata.kind = "mentor_credits" (the mentor checkout and webhook
 * branch) or whose plan id is a configured mentor Whop plan. A refund or dispute
 * that clawed the credits back (ai_credit_lot status clawed_back, or the
 * ai_mentor_revoked_payment tombstone) is subtracted on its own day.
 *
 * Margin needs the Whop fee and the USD to EUR rate verified against real
 * evidence (MENTOR_FINANCE_MODEL, src/lib/mentor/finance.ts). Until both are
 * recorded there, margin is "unavailable" with the reason; no assumed fee is
 * ever shown. The cost side is the measured ledger cost (settle plus house,
 * pick-mentor-cost-assumption A: the USD 0.005 credit is a planning number,
 * the ledger charges actual cost).
 */

import {
  countsAsMoneyIn,
  lastViennaDays,
  viennaDay,
  type Ledger,
  type LedgerEventRow,
  type LedgerPayment,
} from "@/lib/admin/money-rules";
import { MENTOR_CHECKOUT_METADATA_KIND } from "@/lib/mentor/contract";
import { MENTOR_FINANCE_MODEL, mentorMarginDisplayAllowed, type MentorFinanceModel } from "@/lib/mentor/finance";

export const MENTOR_REVENUE_WINDOW_DAYS = 30;

export const MENTOR_REVENUE_BASIS =
  "Mentor payments at their gross Whop amount on the Vienna payment day, per currency; refunds and disputes that clawed credits back are subtracted on their own day at the full charge (no refunded amount is recorded yet).";

export interface MentorRevokedPayment {
  payment_id: string;
  /** When the clawback or tombstone was written. */
  at: string;
  /**
   * "clawback": the ledger clawed a mentor payment lot back (certainly a mentor payment).
   * "tombstone": ai_mentor_revoked_payment, which also records the secondary id of a
   * refund event; an id that is not a counted mentor payment is ignored.
   */
  source: "clawback" | "tombstone";
}

export interface MentorIncludedLot {
  spent_micro: number;
  starts_at: string;
}

export interface MentorRevenueCurrency {
  currency: string;
  gross_cents: number;
  refunded_cents: number;
  net_cents: number;
  payments: number;
  refunds: number;
}

export interface MentorPackageSold {
  package_id: string;
  currency: string;
  gross_cents: number;
  payments: number;
}

export type MentorMarginTone = "ok" | "warn" | "danger";

export type MentorMargin =
  | { available: false; reason: string }
  | { available: true; net_eur_cents: number; fee_eur_cents: number; cost_eur_cents: number; margin_eur_cents: number; margin_pct: number | null; tone: MentorMarginTone };

export interface MentorRevenue {
  window_days: number;
  since: string;
  basis: string;
  by_currency: MentorRevenueCurrency[];
  by_package: MentorPackageSold[];
  /** Mentor payments with no amount ever delivered (not counted in the totals). */
  payments_without_amount: number;
  /** Clawbacks in the window whose payment is not a counted mentor payment (amount unknown). */
  refunds_without_amount: number;
  /** Refunds subtracted at the full charge because no refunded amount is recorded. Margin stays unavailable. */
  refunds_amount_assumed: number;
  /** Mentor Whop plan ids configured in this runtime (0: only tagged payments are recognised). */
  plans_configured: number;
  /** True API cost in the window (settle plus house), micro-USD. null when the rollup is not readable. */
  cost_micro: number | null;
  pro_included: { cost_micro: number; lots: number };
  margin: MentorMargin;
}

function metadataKind(row: LedgerEventRow): string | null {
  const kind = row.metadata?.kind;
  return typeof kind === "string" ? kind : null;
}

/** Payment ids that belong to the mentor (metadata kind or a configured mentor plan). */
export function mentorPaymentIds(rows: readonly LedgerEventRow[], mentorPlanIds: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.payment_id) continue;
    if (metadataKind(row) === MENTOR_CHECKOUT_METADATA_KIND || (row.plan_id && mentorPlanIds.has(row.plan_id))) ids.add(row.payment_id);
  }
  return ids;
}

/** True cost (settle plus house) of the daily Vienna rollup rows inside the window. */
export function mentorCostInWindow(rows: ReadonlyArray<{ day: string; mentor_micro: number | string | null }>, now: Date): number {
  const days = new Set(lastViennaDays(now, MENTOR_REVENUE_WINDOW_DAYS));
  return rows.reduce((sum, row) => (days.has(String(row.day).slice(0, 10)) ? sum + Number(row.mentor_micro ?? 0) : sum), 0);
}

/** Margin tone: amber under 50 percent, red under 30 percent (MUX-98). */
export function marginTone(pct: number | null): MentorMarginTone {
  if (pct === null) return "warn";
  if (pct < 30) return "danger";
  if (pct < 50) return "warn";
  return "ok";
}

export function computeMentorRevenue(input: {
  ledger: Ledger;
  mentorIds: ReadonlySet<string>;
  /** plan id -> mentor package id, from the configured Whop plan env. */
  planPackages: ReadonlyMap<string, string>;
  revoked: readonly MentorRevokedPayment[];
  includedLots: readonly MentorIncludedLot[];
  costMicro: number | null;
  now: Date;
  finance?: Readonly<MentorFinanceModel>;
}): MentorRevenue {
  const days = new Set(lastViennaDays(input.now, MENTOR_REVENUE_WINDOW_DAYS));
  const since = [...days].sort()[0];
  const inWindow = (at: string) => days.has(viennaDay(at));
  const byId = new Map<string, LedgerPayment>();
  for (const p of input.ledger.payments) if (input.mentorIds.has(p.payment_id)) byId.set(p.payment_id, p);

  const currencies = new Map<string, MentorRevenueCurrency>();
  const cur = (currency: string) => {
    let row = currencies.get(currency);
    if (!row) currencies.set(currency, (row = { currency, gross_cents: 0, refunded_cents: 0, net_cents: 0, payments: 0, refunds: 0 }));
    return row;
  };
  const packages = new Map<string, MentorPackageSold>();
  const counted: LedgerPayment[] = [];
  let withoutAmount = 0;

  for (const p of byId.values()) {
    if (!inWindow(p.paid_at)) continue;
    if (p.gross_cents == null) { withoutAmount++; continue; }
    if (!countsAsMoneyIn(p)) continue;
    counted.push(p);
    const row = cur(p.currency);
    row.gross_cents += p.gross_cents;
    row.payments++;
    const pkg = (p.plan_id && input.planPackages.get(p.plan_id)) || "other";
    const key = `${pkg}:${p.currency}`;
    const sold = packages.get(key) ?? { package_id: pkg, currency: p.currency, gross_cents: 0, payments: 0 };
    sold.gross_cents += p.gross_cents;
    sold.payments++;
    packages.set(key, sold);
  }

  // One subtraction per payment id, on the earliest revoke record in the window.
  const firstRevoke = new Map<string, { at: string; clawback: boolean }>();
  for (const r of input.revoked) {
    if (!r.payment_id || !inWindow(r.at)) continue;
    const prev = firstRevoke.get(r.payment_id);
    firstRevoke.set(r.payment_id, { at: !prev || r.at < prev.at ? r.at : prev.at, clawback: (prev?.clawback ?? false) || r.source === "clawback" });
  }
  let refundsWithoutAmount = 0;
  let refundsAmountAssumed = 0;
  const refunded: Array<{ currency: string; cents: number }> = [];
  for (const [paymentId, revoke] of firstRevoke) {
    // Only payments this view counted as mentor money: an untagged payment was never in gross.
    const p = byId.get(paymentId);
    if (!p || p.gross_cents == null) { if (revoke.clawback) refundsWithoutAmount++; continue; }
    if (!countsAsMoneyIn(p)) continue;
    // payment_events carries no refunded-amount field (a payment.refunded row holds the
    // payment's own net amount), so the full charge is subtracted and marked assumed
    // until a real Whop refund payload confirms one. The mentor claws the whole lot back.
    const cents = p.gross_cents;
    refundsAmountAssumed++;
    refunded.push({ currency: p.currency, cents });
    const row = cur(p.currency);
    row.refunded_cents += cents;
    row.refunds++;
  }
  for (const row of currencies.values()) row.net_cents = row.gross_cents - row.refunded_cents;

  const proIncluded = { cost_micro: 0, lots: 0 };
  for (const lot of input.includedLots) {
    if (!inWindow(lot.starts_at)) continue;
    proIncluded.cost_micro += Math.max(0, lot.spent_micro);
    proIncluded.lots++;
  }

  return {
    window_days: MENTOR_REVENUE_WINDOW_DAYS,
    since,
    basis: MENTOR_REVENUE_BASIS,
    by_currency: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    by_package: [...packages.values()].sort((a, b) => a.package_id.localeCompare(b.package_id) || a.currency.localeCompare(b.currency)),
    payments_without_amount: withoutAmount,
    refunds_without_amount: refundsWithoutAmount,
    refunds_amount_assumed: refundsAmountAssumed,
    plans_configured: input.planPackages.size,
    cost_micro: input.costMicro,
    pro_included: proIncluded,
    margin: computeMargin(counted, refunded, input.costMicro, refundsWithoutAmount + refundsAmountAssumed, input.finance ?? MENTOR_FINANCE_MODEL),
  };
}

function computeMargin(
  counted: readonly LedgerPayment[],
  refunded: ReadonlyArray<{ currency: string; cents: number }>,
  costMicro: number | null,
  uncertainRefunds: number,
  finance: Readonly<MentorFinanceModel>,
): MentorMargin {
  if (!mentorMarginDisplayAllowed(finance) || !finance.whopFee || !finance.usdPerEur) {
    return { available: false, reason: "The Whop fee and the USD to EUR rate are not verified against the Whop account yet. No assumed fee is shown." };
  }
  if (costMicro === null) return { available: false, reason: "The daily cost rollup is not readable, so cost for the window is unknown." };
  if ([...counted, ...refunded].some((p) => p.currency.toUpperCase() !== "EUR")) {
    return { available: false, reason: "Some mentor payments are not in EUR; margin is shown only for EUR payments." };
  }
  if (uncertainRefunds > 0) return { available: false, reason: "A refund in the window was subtracted at the full charge because no refunded amount is recorded, so net revenue is uncertain." };
  const fee = finance.whopFee;
  const gross = counted.reduce((s, p) => s + (p.gross_cents ?? 0), 0);
  const net = gross - refunded.reduce((s, r) => s + r.cents, 0);
  // Whop keeps its fee on a charge even when it is later refunded.
  const feeCents = Math.round(counted.reduce((s, p) => s + fee.fixedEurCents + ((p.gross_cents ?? 0) * fee.percent) / 100, 0));
  const costCents = Math.round(costMicro / 10_000 / finance.usdPerEur.value);
  const margin = net - feeCents - costCents;
  const pct = net > 0 ? Math.round((margin / net) * 1000) / 10 : null;
  // No net revenue against any cost is a loss, not "watch".
  const tone: MentorMarginTone = pct === null && margin < 0 ? "danger" : marginTone(pct);
  return { available: true, net_eur_cents: net, fee_eur_cents: feeCents, cost_eur_cents: costCents, margin_eur_cents: margin, margin_pct: pct, tone };
}
