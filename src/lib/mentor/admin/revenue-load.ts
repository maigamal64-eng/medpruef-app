/**
 * Server loader for the mentor revenue tiles (a40, MUX-98). READ-ONLY.
 * Reads payment_events through the shared admin money loaders (paged, never a
 * truncated total) plus the mentor ledger rows that say which payments were
 * clawed back and what the Pro-included lots consumed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLedger } from "@/lib/admin/money-rules";
import { loadLedgerRows, loadResolutions, readAll } from "@/lib/admin/moneyMetrics";
import { assertReadSucceeded } from "@/lib/admin/read-result";
import { MENTOR_WHOP_PLAN_ENV } from "@/lib/mentor/config";
import {
  computeMentorRevenue,
  mentorCostInWindow,
  mentorPaymentIds,
  MENTOR_REVENUE_WINDOW_DAYS,
  type MentorIncludedLot,
  type MentorRevenue,
  type MentorRevokedPayment,
} from "./revenue";

/** plan id -> package id for the configured mentor Whop plans. */
export function mentorPlanPackages(env: Record<string, string | undefined>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [pkg, key] of Object.entries(MENTOR_WHOP_PLAN_ENV)) {
    const plan = env[key]?.trim();
    if (plan) out.set(plan, pkg);
  }
  return out;
}

export async function loadMentorRevenue(
  db: SupabaseClient,
  now: Date,
  env: Record<string, string | undefined> = process.env,
): Promise<MentorRevenue> {
  // Two days of slack so the Vienna-day window never misses an edge row.
  const sinceIso = new Date(now.getTime() - (MENTOR_REVENUE_WINDOW_DAYS + 2) * 86_400_000).toISOString();
  const sinceDay = sinceIso.slice(0, 10);
  const [rows, resolutions, clawbacks, tombstones, paymentLots, included, cost] = await Promise.all([
    loadLedgerRows(db),
    loadResolutions(db),
    // The append-only clawback rows date a refund; source_id is "whop_payment:<payment id>".
    readAll<{ source_id: string; created_at: string }>((from, to) =>
      db.from("ai_usage_ledger").select("source_id, created_at")
        .eq("kind", "clawback").gte("created_at", sinceIso)
        .order("created_at", { ascending: true }).range(from, to)),
    readAll<{ payment_id: string; created_at: string }>((from, to) =>
      db.from("ai_mentor_revoked_payment").select("payment_id, created_at")
        .gte("created_at", sinceIso).order("created_at", { ascending: true }).range(from, to)),
    // Granted mentor payment lots: a mentor payment even when its grant_succeeded row was not logged.
    readAll<{ whop_payment_id: string | null }>((from, to) =>
      db.from("ai_credit_lot").select("whop_payment_id")
        .eq("source", "whop_payment").gte("created_at", sinceIso)
        .order("created_at", { ascending: true }).range(from, to)),
    readAll<MentorIncludedLot>((from, to) =>
      db.from("ai_credit_lot").select("spent_micro, starts_at")
        .eq("source", "pro_included").gte("starts_at", sinceIso)
        .order("starts_at", { ascending: true }).range(from, to)),
    // The rollup is optional (R4 changeset); an unreadable rollup leaves cost unknown, never 0.
    Promise.resolve(
      db.from("ai_mentor_daily_cost").select("day, mentor_micro").eq("timezone", "Europe/Vienna").gte("day", sinceDay),
    ).then((res) => { assertReadSucceeded(res); return (res.data ?? []) as Array<{ day: string; mentor_micro: number }>; })
      .catch(() => null),
  ]);

  const planPackages = mentorPlanPackages(env);
  const PREFIX = "whop_payment:";
  const clawed: MentorRevokedPayment[] = clawbacks
    .filter((r) => r.source_id.startsWith(PREFIX) && r.source_id.length > PREFIX.length)
    .map((r) => ({ payment_id: r.source_id.slice(PREFIX.length), at: r.created_at, source: "clawback" }));
  const revoked: MentorRevokedPayment[] = [
    ...clawed,
    ...tombstones.map((r) => ({ payment_id: r.payment_id, at: r.created_at, source: "tombstone" as const })),
  ];
  const mentorIds = mentorPaymentIds(rows, new Set(planPackages.keys()));
  for (const lot of paymentLots) if (lot.whop_payment_id) mentorIds.add(lot.whop_payment_id);
  for (const r of clawed) mentorIds.add(r.payment_id);
  return computeMentorRevenue({
    ledger: buildLedger(rows, resolutions.rows),
    mentorIds,
    planPackages,
    revoked,
    includedLots: included,
    costMicro: cost === null ? null : mentorCostInWindow(cost, now),
    now,
  });
}
