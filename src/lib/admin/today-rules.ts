/**
 * Today page money rows (a18, ADM-11 A). Pure: the overview route loads the
 * rows through moneyMetrics and this module classifies them with the shared
 * definitions in money-rules.ts, so Today, Payments and the paid roster
 * never disagree.
 *
 *   Payments that did not grant access = the Unresolved payments queue.
 *   Refunds (7 days)                   = refunds booked in the last 7 days.
 *   Pro ends within 7 days, no renewal = paying learners whose last active
 *                                        row ends within 7 days and none of
 *                                        whose active rows renews by itself.
 */

import { classifySubscriptionCadence } from "@/lib/billing-cadence";
import {
  daysLeft,
  isActiveUnexpired,
  isUnresolvedPayment,
  rowPaymentIds,
  type Ledger,
  type LedgerPayment,
  type SubscriptionLike,
} from "./money-rules";

const DAY_MS = 86_400_000;

export interface TodayMoneyNeeds {
  unresolved: { count: number; oldest_at: string | null; currencies: string[] };
  refunds_7d: { count: number; by_currency: Array<{ currency: string; cents: number }> };
  ending_7d: { count: number; soonest_days: number | null };
}

export function computeTodayMoneyNeeds(
  ledger: Ledger,
  subs: SubscriptionLike[],
  paying: ReadonlySet<string>,
  now: Date,
  paymentsById: Map<string, LedgerPayment>,
): TodayMoneyNeeds {
  const unresolved = ledger.payments.filter(isUnresolvedPayment).sort((a, b) => a.paid_at.localeCompare(b.paid_at));

  const since = now.getTime() - 7 * DAY_MS;
  const refunds = ledger.refunds.filter((r) => Date.parse(r.refunded_at) >= since && Date.parse(r.refunded_at) <= now.getTime());
  const byCurrency = new Map<string, number>();
  for (const r of refunds) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + (r.amount_cents ?? 0));

  let ending = 0;
  let soonest: number | null = null;
  for (const userId of paying) {
    const rows = subs.filter((s) => s.user_id === userId && isActiveUnexpired(s, now));
    if (rows.length === 0) continue;
    const renews = rows.some((s) => classifySubscriptionCadence({
      tier: s.tier ?? "",
      payment_provider: s.payment_provider,
      plan_id: rowPaymentIds(s).map((id) => paymentsById.get(id)?.plan_id).find(Boolean) ?? null,
    }) === "auto_renews");
    if (renews) continue;
    // A row with no end date never ends, so the learner is not ending.
    if (rows.some((s) => !s.expires_at)) continue;
    const last = rows.reduce((max, s) => (Date.parse(s.expires_at as string) > Date.parse(max) ? (s.expires_at as string) : max), rows[0].expires_at as string);
    const left = daysLeft(last, now);
    if (left == null || left > 7) continue;
    ending += 1;
    soonest = soonest == null ? left : Math.min(soonest, left);
  }

  return {
    unresolved: {
      count: unresolved.length,
      oldest_at: unresolved[0]?.paid_at ?? null,
      currencies: [...new Set(unresolved.map((p) => p.currency))].sort(),
    },
    refunds_7d: {
      count: refunds.length,
      by_currency: [...byCurrency].map(([currency, cents]) => ({ currency, cents })).sort((a, b) => a.currency.localeCompare(b.currency)),
    },
    ending_7d: { count: ending, soonest_days: soonest },
  };
}

/** "3 days", "5 hours", "under an hour": how long the oldest item has waited. */
export function waitedFor(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

const VIENNA_HM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Vienna" });

/** Midnight at the start of the current Vienna day, as an instant. */
export function viennaStartOfDay(now: Date, viennaDayOf: (d: Date) => string): Date {
  const day = viennaDayOf(now);
  for (const offset of ["+01:00", "+02:00"]) {
    const candidate = new Date(`${day}T00:00:00${offset}`);
    if (viennaDayOf(candidate) === day && VIENNA_HM.format(candidate) === "00:00") return candidate;
  }
  return new Date(`${day}T00:00:00Z`);
}
