/**
 * controlPlaneMetrics — the north-star measurement block behind
 * /admin/control-plane (Autonomy Control Plane v1, AUTONOMY.md F-07).
 *
 * Why this lives apart from /api/admin/overview's inline math:
 *  - The Mission-Control overview measures *operational* signals (today's
 *    revenue, queues, infra). This module measures the *business north-star*
 *    the autonomy roadmap is graded on: MRR, paid conversion, churn, LTV.
 *  - AUTONOMY.md's one rule: "Euros stay top-line. Automation-coverage % is
 *    a secondary efficiency stat, never the success metric." So the euro
 *    figures are computed here as the headline; coverage % is derived from
 *    the process registry separately (computeCoverage) and rendered smaller.
 *
 * THE REVENUE-TRUTH DECISION (verified against prod xfgllbkpgbginbjikjbb
 * on 2026-06-23, read-only):
 *  - The `subscriptions` table has ZERO rows in status='active'. Every row
 *    is an abandoned NOWPayments crypto checkout (pending/cancelled/expired).
 *  - Pro access is granted by flipping `users.tier='pro'` (+ `tier_expires_at`)
 *    — that is how both the live Whop card rail and manual/gifted grants work.
 *    There is no Whop column on `subscriptions`.
 *  - Therefore the money-truth is "users currently entitled to Pro", NOT
 *    "active subscription rows". Computing MRR from active rows alone would
 *    print €0 next to 2 paying users — that reads as a bug and buries the
 *    euros the roadmap says must be top-line.
 *
 * So: paid users = entitled Pro users; MRR = entitled × the monthly-equivalent
 * of the live €114/6-month pass (priceCents/durationMonths from the canonical
 * TIERS catalogue). The subscription-row active count (0) is surfaced as a
 * transparent reconciliation line so nothing is hidden — see `reconciliation`.
 *
 * Every figure is annotated with `basis` so the UI can show the method and
 * the panel can never be read as fiction.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { TIERS } from "@/lib/nowpayments";
import { CONTROL_PLANE_PROCESSES, type AutomationLevel } from "./processRegistry";

/** The live headline offer the MRR/LTV model is priced from. */
const HEADLINE_TIER_ID = "premium_pass_guaranteed";

function headlineOffer(): { priceCents: number; durationMonths: number } {
  const def = TIERS[HEADLINE_TIER_ID];
  // Defensive fallback to the documented €114/6-month pass if the catalogue
  // entry is ever renamed — keeps the route from throwing on a config drift.
  return {
    priceCents: def?.priceCents ?? 11400,
    durationMonths: def?.durationMonths ?? 6,
  };
}

export interface ControlPlaneMetrics {
  generated_at: string;
  /** EUROS — top-line. */
  mrr_cents: number;
  /** Users entitled to Pro right now (the paying base). */
  active_paid_users: number;
  /** Pro users all-time / total users — the conversion the roadmap moves. */
  paid_conversion: {
    pro_users: number;
    total_users: number;
    /** ratio 0..1 (multiply by 100 for %). */
    ratio: number;
  };
  /** Subscriptions entering cancelled/refunded/expired in the last 30 days. */
  churn_30d: number;
  /** Simple LTV: modeled lifetime value per paying user, in cents. */
  ltv_cents: number;
  /** Plain-language note on how each euro figure was derived. */
  basis: {
    mrr: string;
    ltv: string;
    conversion: string;
    churn: string;
  };
  /** Transparency: the raw subscription-row truth, so €0-active isn't hidden. */
  reconciliation: {
    active_subscription_rows: number;
    note: string;
  };
  /** SECONDARY efficiency stat — automation coverage from the process registry. */
  automation_coverage: {
    /** weighted 0..1 across the 8 processes' current L vs ceiling L4. */
    ratio: number;
    process_count: number;
    /** count of processes at each current level, e.g. { L0: 2, L1: 5, L3: 1 }. */
    by_level: Record<string, number>;
  };
}

/**
 * Coverage = mean(currentL / 4) across the 8 processes. L4 is the ceiling of
 * the ladder (L0 manual → L4 self-improving), so a process at L1 is 25%
 * "covered". This is intentionally simple + deterministic; it is the SECONDARY
 * stat per AUTONOMY.md and must never outshine euros.
 */
export function computeCoverage(
  processes: ReadonlyArray<{ currentLevel: AutomationLevel }> = CONTROL_PLANE_PROCESSES
): ControlPlaneMetrics["automation_coverage"] {
  const byLevel: Record<string, number> = {};
  let sum = 0;
  for (const p of processes) {
    const n = levelToNumber(p.currentLevel);
    sum += n / 4;
    byLevel[p.currentLevel] = (byLevel[p.currentLevel] ?? 0) + 1;
  }
  const count = processes.length || 1;
  return {
    ratio: sum / count,
    process_count: processes.length,
    by_level: byLevel,
  };
}

function levelToNumber(l: AutomationLevel): number {
  // "L2" -> 2. Anything unexpected floors to 0.
  const n = Number(l.replace(/^L/i, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute the full north-star block from the live DB. READ-ONLY: every query
 * here is a SELECT/count; this never mutates. SQL verified against prod on
 * 2026-06-23 (numbers at the bottom of the route file).
 */
export async function computeControlPlaneMetrics(
  sb: SupabaseClient
): Promise<ControlPlaneMetrics> {
  const now = new Date();
  const thirtyDaysAgoIso = new Date(
    now.getTime() - 30 * 86_400_000
  ).toISOString();
  const offer = headlineOffer();

  const [
    totalUsersRes,
    proAllTimeRes,
    proEntitledRes,
    activeRowsRes,
    churn30dRes,
  ] = await Promise.all([
    // total users
    sb.from("users").select("id", { count: "exact", head: true }),
    // pro users all-time (the conversion numerator the roadmap names: 2/113)
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tier", "pro"),
    // pro users entitled RIGHT NOW (paying base for MRR) — tier='pro' AND
    // (tier_expires_at IS NULL OR tier_expires_at > now()).
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tier", "pro")
      .or(`tier_expires_at.is.null,tier_expires_at.gt.${now.toISOString()}`),
    // subscription rows truly in status='active' (the reconciliation truth = 0 today)
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    // churn: rows that ENTERED a churned state in the last 30d (by updated_at)
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["cancelled", "refunded", "expired"])
      .gte("updated_at", thirtyDaysAgoIso),
  ]);

  const totalUsers = totalUsersRes.count ?? 0;
  const proAllTime = proAllTimeRes.count ?? 0;
  const proEntitled = proEntitledRes.count ?? 0;
  const activeRows = activeRowsRes.count ?? 0;
  const churn30d = churn30dRes.count ?? 0;

  // MRR = entitled paying users × monthly-equivalent of the €114/6-mo pass.
  const monthlyEquivCents = Math.round(offer.priceCents / offer.durationMonths);
  const mrrCents = proEntitled * monthlyEquivCents;

  // Simple LTV = value of one full pass per paying user. With the headline
  // pass that's the pass price itself (the modeled lifetime spend of a payer).
  const ltvCents = offer.priceCents;

  const ratio = totalUsers > 0 ? proAllTime / totalUsers : 0;

  return {
    generated_at: now.toISOString(),
    mrr_cents: mrrCents,
    active_paid_users: proEntitled,
    paid_conversion: {
      pro_users: proAllTime,
      total_users: totalUsers,
      ratio,
    },
    churn_30d: churn30d,
    ltv_cents: ltvCents,
    basis: {
      mrr: `${proEntitled} entitled Pro user${proEntitled === 1 ? "" : "s"} × €${(monthlyEquivCents / 100).toFixed(0)}/mo (the €${(offer.priceCents / 100).toFixed(0)} ${offer.durationMonths}-month pass, monthly-equivalent). Pro is granted on users.tier — there are no active subscription rows yet.`,
      ltv: `Modeled at one full €${(offer.priceCents / 100).toFixed(0)} pass per paying user (no completed subscription rows to average over yet).`,
      conversion: `Pro users ÷ total users = ${proAllTime}/${totalUsers}. The number to move.`,
      churn: `Subscriptions entering cancelled / refunded / expired in the last 30 days.`,
    },
    reconciliation: {
      active_subscription_rows: activeRows,
      note:
        activeRows === 0
          ? "0 rows in subscriptions.status='active'. Pro is granted directly on users.tier (Whop card rail + manual grants), so the paying base is measured from entitled Pro users, not subscription rows. The pending/cancelled rows are abandoned NOWPayments crypto checkouts."
          : "Active subscription rows present; paying base still measured from entitled Pro users (users.tier) as the source of truth.",
    },
    automation_coverage: computeCoverage(),
  };
}
