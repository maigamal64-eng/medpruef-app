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
 * THE REVENUE-TRUTH DECISION (corrected 2026-06-23; verified against prod
 * xfgllbkpgbginbjikjbb, read-only — see route.ts for the audited SQL):
 *
 *  The headline conversion / MRR / active-paid must reflect REAL PAYING
 *  CUSTOMERS — accounts where money actually changed hands — and nothing
 *  else. Three classes of `tier='pro'` account are NOT paying customers and
 *  were previously inflating the numbers:
 *    1. the admin account (`role='admin'` — admin@medpruf.com),
 *    2. the comped client [name] (gifted Pro, user-c75a6967@example.com),
 *    3. a demo / test account (user-4eeaf88f@example.com).
 *  All three carry an internal `@medpruf.com` email; admin also carries
 *  `role='admin'`. We exclude both markers (see INTERNAL_EMAIL_DOMAINS /
 *  isInternalAccount). As of 2026-06-23 prod has 2 `tier='pro'` rows (admin +
 *  demo) and 0 completed/active paid subscriptions → genuinely-paying = 0.
 *
 *  REAL PAYING is measured from the `subscriptions` table, NOT users.tier:
 *  the live Whop card rail INSERTs an `status='active', payment_provider='whop'`
 *  row on every successful payment (see api/webhooks/whop), so "distinct users
 *  with an active, unexpired sub on a real rail (whop/stripe — manual/comped
 *  excluded)" is the robust, self-ticking truth. It is 0 today and rises by
 *  itself on the first real card payment. users.tier is the WRONG basis for
 *  "paying" — it is exactly what counted admin/demo/comped as customers.
 *
 *  MRR = real-paying users × the monthly-equivalent of the live €129/6-month
 *  pass (priceCents/durationMonths from the canonical TIERS catalogue). With
 *  0 real payers, MRR is honestly €0 — not the €19 a demo account would print.
 *
 *  Nothing is hidden: a separate `entitled_pro` block keeps the full
 *  Pro-access picture (incl. admin/demo/comped), and `reconciliation` states
 *  the raw subscription-row truth + the corrected definitions.
 *
 *  CHURN counts only subs that were ACTUALLY ACTIVATED then lost in the last
 *  30 days (`expires_at IS NOT NULL` — the grant path stamps expires_at only
 *  on activation). An abandoned NOWPayments crypto checkout that flips
 *  pending→cancelled/expired without ever activating (expires_at IS NULL) is
 *  NOT churn — it never paid. Real churn is 0 today (the old query read 1, a
 *  same-day-abandoned checkout whose updated_at was later bumped into window).
 *
 * Every figure is annotated with `basis` so the UI can show the method and
 * the panel can never be read as fiction.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { TIERS } from "@/lib/nowpayments";
import { CONTROL_PLANE_PROCESSES, type AutomationLevel } from "./processRegistry";

/**
 * Email domains whose accounts are NOT real paying customers (admin, the comped
 * client [name], demo/test users all live on @medpruf.com). Excluded from the
 * genuinely-paying numerator AND the real-users denominator.
 */
const INTERNAL_EMAIL_DOMAINS = ["@medpruf.com", "@medpruef.com"];

/** Payment rails that represent real money changing hands (manual = comped/gift). */
const REAL_PAYMENT_RAILS = ["whop", "stripe", "nowpayments"] as const;

function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return INTERNAL_EMAIL_DOMAINS.some((d) => e.endsWith(d));
}

/** The live headline offer the MRR/LTV model is priced from. */
const HEADLINE_TIER_ID = "premium_pass_guaranteed";

function headlineOffer(): { priceCents: number; durationMonths: number } {
  const def = TIERS[HEADLINE_TIER_ID];
  // Defensive fallback to the documented €129/6-month pass if the catalogue
  // entry is ever renamed — keeps the route from throwing on a config drift.
  return {
    priceCents: def?.priceCents ?? 12900,
    durationMonths: def?.durationMonths ?? 6,
  };
}

export interface ControlPlaneMetrics {
  generated_at: string;
  /** EUROS — top-line. MRR from REAL paying customers only (0 if none). */
  mrr_cents: number;
  /** Real paying customers right now (active unexpired sub on a real rail). */
  active_paid_users: number;
  /**
   * The headline conversion the roadmap moves: GENUINELY-PAYING customers ÷
   * real users. Excludes admin / comped client / demo accounts from both the
   * numerator (paying_users) and the denominator (total_users).
   */
  paid_conversion: {
    /** Real paying customers, all-rails, active+unexpired. NOT users.tier. */
    paying_users: number;
    /** Real users = all users minus admin / internal (@medpruf.com) accounts. */
    total_users: number;
    /** ratio 0..1 (multiply by 100 for %). */
    ratio: number;
  };
  /**
   * Pro ACCESS picture incl. comped — so nothing is hidden. These are entitled
   * to Pro but are NOT (necessarily) paying customers: admin, the comped
   * client, the demo user all land here.
   */
  entitled_pro: {
    /** Entitled to Pro right now (tier='pro' AND not expired) — incl. comped. */
    entitled_now: number;
    /** Ever granted Pro (tier='pro') — incl. comped. */
    entitled_all_time: number;
  };
  /**
   * Subscriptions that were ACTUALLY ACTIVATED (expires_at set) then entered
   * cancelled/refunded/expired in the last 30 days. Abandoned crypto checkouts
   * (never activated, expires_at NULL) are NOT counted.
   */
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
  const nowIso = now.toISOString();
  const thirtyDaysAgoIso = new Date(
    now.getTime() - 30 * 86_400_000
  ).toISOString();
  const offer = headlineOffer();

  const [
    allUsersRes,
    proAllTimeRes,
    proEntitledRes,
    activeRowsRes,
    activeSubsRes,
    realChurn30dRes,
  ] = await Promise.all([
    // EVERY user's id+email+role — so we can subtract internal/admin accounts
    // from the real-users denominator in JS (a single cheap projection).
    sb.from("users").select("id, email, role"),
    // entitled-Pro ALL-TIME (incl. comped/admin/demo) — the "nothing hidden" line.
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tier", "pro"),
    // entitled-Pro RIGHT NOW (incl. comped) — tier='pro' AND not expired.
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("tier", "pro")
      .or(`tier_expires_at.is.null,tier_expires_at.gt.${nowIso}`),
    // raw active subscription rows (reconciliation truth = 0 today).
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    // REAL paying base: active subs on a real rail (whop/stripe/nowpayments —
    // manual/comped excluded), unexpired. Fetched (not head-counted) so we can
    // de-dupe by user_id and drop any internal account. Tiny set (0 today).
    sb
      .from("subscriptions")
      .select("user_id, expires_at")
      .eq("status", "active")
      .in("payment_provider", REAL_PAYMENT_RAILS as unknown as string[]),
    // REAL churn: subs that were ACTUALLY ACTIVATED (expires_at set) then lost
    // in the last 30d. Abandoned crypto checkouts (expires_at NULL) excluded.
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .in("status", ["cancelled", "refunded", "expired"])
      .not("expires_at", "is", null)
      .gte("updated_at", thirtyDaysAgoIso),
  ]);

  const allUsers = (allUsersRes.data ?? []) as Array<{
    id: string;
    email: string | null;
    role: string | null;
  }>;
  // Real users = exclude admins + internal (@medpruf.com) accounts (admin,
  // comped client [name], demo/test all live there).
  const realUserIds = new Set<string>();
  for (const u of allUsers) {
    if (u.role === "admin") continue;
    if (isInternalEmail(u.email)) continue;
    realUserIds.add(u.id);
  }
  const realUsers = realUserIds.size;

  const proAllTime = proAllTimeRes.count ?? 0; // entitled incl. comped
  const proEntitled = proEntitledRes.count ?? 0; // entitled-now incl. comped
  const activeRows = activeRowsRes.count ?? 0;
  const churn30d = realChurn30dRes.count ?? 0;

  // REAL paying customers = distinct REAL users holding an active+unexpired sub
  // on a real rail. (0 today; ticks up by itself on the first card payment.)
  const activeSubs = (activeSubsRes.data ?? []) as Array<{
    user_id: string | null;
    expires_at: string | null;
  }>;
  const payingUserIds = new Set<string>();
  for (const s of activeSubs) {
    if (!s.user_id) continue;
    if (!realUserIds.has(s.user_id)) continue; // drop internal/comped/admin
    const unexpired = !s.expires_at || new Date(s.expires_at).getTime() > now.getTime();
    if (unexpired) payingUserIds.add(s.user_id);
  }
  const payingUsers = payingUserIds.size;

  // MRR = REAL paying users × monthly-equivalent of the €129/6-mo pass.
  // 0 payers ⇒ €0 (the honest figure; not the €19 a demo account would print).
  const monthlyEquivCents = Math.round(offer.priceCents / offer.durationMonths);
  const mrrCents = payingUsers * monthlyEquivCents;

  // Simple LTV = value of one full pass per paying user. With the headline
  // pass that's the pass price itself (the modeled lifetime spend of a payer).
  const ltvCents = offer.priceCents;

  // Conversion = REAL paying ÷ REAL users (both exclude admin/comped/demo).
  const ratio = realUsers > 0 ? payingUsers / realUsers : 0;

  return {
    generated_at: nowIso,
    mrr_cents: mrrCents,
    active_paid_users: payingUsers,
    paid_conversion: {
      paying_users: payingUsers,
      total_users: realUsers,
      ratio,
    },
    entitled_pro: {
      entitled_now: proEntitled,
      entitled_all_time: proAllTime,
    },
    churn_30d: churn30d,
    ltv_cents: ltvCents,
    basis: {
      mrr:
        payingUsers === 0
          ? `€0 — no genuinely-paying customers yet. (Admin, the comped client, and the demo account are excluded; they hold Pro but never paid.) Rises automatically on the first real card payment, priced from the €${(offer.priceCents / 100).toFixed(0)} ${offer.durationMonths}-month pass.`
          : `${payingUsers} real paying customer${payingUsers === 1 ? "" : "s"} × €${(monthlyEquivCents / 100).toFixed(0)}/mo (the €${(offer.priceCents / 100).toFixed(0)} ${offer.durationMonths}-month pass, monthly-equivalent). Comped / admin / demo accounts excluded.`,
      ltv: `Modeled at one full €${(offer.priceCents / 100).toFixed(0)} pass per paying customer (no completed paid subscriptions to average over yet).`,
      conversion: `Genuinely-paying customers ÷ real users = ${payingUsers}/${realUsers}. Excludes the admin account, the comped client, and the demo user from both sides. ${proEntitled} account${proEntitled === 1 ? " is" : "s are"} entitled to Pro (incl. comped) — shown separately. The number to move.`,
      churn: `Subscriptions that were activated (expires_at set) then cancelled / refunded / expired in the last 30 days. Abandoned crypto checkouts that never activated are not counted.`,
    },
    reconciliation: {
      active_subscription_rows: activeRows,
      note:
        payingUsers === 0
          ? `Corrected definitions (2026-06-23): paid conversion = genuinely-paying customers ÷ real users = 0/${realUsers} (admin / comped client / demo excluded from both); MRR = €0 (no real payers — a demo account is not revenue); churn counts only activated subs lost in 30d, so abandoned crypto checkouts (the ${activeRows === 0 ? "pending/cancelled/expired" : "non-active"} NOWPayments rows) do NOT count as churn / active / MRR. Real paying is read from active subscription rows on a real rail (whop/stripe), which is ${activeRows} active today; ${proEntitled} account${proEntitled === 1 ? " is" : "s are"} entitled to Pro incl. comped. These figures tick up on their own with the first real card payment.`
          : `${activeRows} active subscription row${activeRows === 1 ? "" : "s"}. Paid conversion, MRR, active-paid count only genuinely-paying customers (admin / comped / demo excluded); ${proEntitled} entitled to Pro incl. comped, shown separately. Churn counts only activated subs lost in the last 30 days.`,
    },
    automation_coverage: computeCoverage(),
  };
}
