import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { computeControlPlaneMetrics } from "@/lib/admin/controlPlaneMetrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/admin/control-plane — the north-star measurement block
 * behind /admin/control-plane (Autonomy Control Plane v1, AUTONOMY.md F-07).
 *
 * Guarded by adminRouteShell (requireAdmin + per-admin rate limit). Note this
 * lives under /api/stats/admin/* but, unlike the legacy /api/stats/admin
 * routes (B-17), it goes THROUGH the audited shell — it does not bypass it.
 *
 * Returns euros top-line (MRR, active paid users, paid conversion, churn, LTV)
 * plus a SECONDARY automation-coverage % derived from the static process
 * registry. All computation is read-only; see controlPlaneMetrics.ts for the
 * revenue-truth decision (Pro is granted on users.tier, subscriptions has 0
 * active rows).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VERIFIED SQL (run read-only against prod xfgllbkpgbginbjikjbb, 2026-06-23,
 * CORRECTED to count only REAL paying customers — admin / comped client /
 * demo excluded — and to exclude abandoned crypto checkouts from churn).
 * The Supabase JS calls in computeControlPlaneMetrics() are the typed
 * equivalents of these; kept here as the human-auditable source of the math.
 *
 *   -- real users (denominator): exclude admin + internal @medpruf.com accounts
 *   -- (admin, comped client [name], demo/test all live on @medpruf.com). NOTE
 *   -- 58/114 users are Telegram-auth with a NULL email — they ARE real users
 *   -- and must be KEPT, so the email test is guarded with `email IS NULL OR`
 *   -- (the code's isInternalEmail() returns false for null; a bare NOT ILIKE
 *   -- would wrongly drop all 58 null-email users → 54).
 *   SELECT count(*) FILTER (
 *            WHERE role <> 'admin'
 *              AND (email IS NULL OR email NOT ILIKE '%@medpruf.com')
 *          )                                                  AS real_users      -- 112
 *   FROM users;
 *
 *   -- entitled Pro (incl. comped — the "nothing hidden" line, NOT revenue)
 *   SELECT
 *     count(*) FILTER (WHERE tier='pro')                       AS entitled_all   -- 2 (admin+demo)
 *   , count(*) FILTER (WHERE tier='pro'
 *        AND (tier_expires_at IS NULL
 *             OR tier_expires_at > now()))                     AS entitled_now   -- 1 (demo; admin expired)
 *   FROM users;
 *
 *   -- REAL paying customers (numerator + active-paid): active, unexpired sub
 *   -- on a real rail (whop/stripe/nowpayments), held by a non-internal user.
 *   -- users.tier is NOT used — it is exactly what counted comped/admin/demo.
 *   SELECT count(DISTINCT s.user_id)                           AS paying_users   -- 0
 *   FROM subscriptions s JOIN users u ON u.id = s.user_id
 *   WHERE s.status='active'
 *     AND s.payment_provider IN ('whop','stripe','nowpayments')
 *     AND (s.expires_at IS NULL OR s.expires_at > now())
 *     AND u.role <> 'admin'
 *     AND (u.email IS NULL OR u.email NOT ILIKE '%@medpruf.com');
 *
 *   -- subscription reconciliation + REAL churn
 *   SELECT
 *     count(*) FILTER (WHERE status='active')                  AS active_rows    -- 0
 *   , count(*) FILTER (WHERE status IN ('cancelled','refunded','expired')
 *        AND expires_at IS NOT NULL                            -- WAS activated
 *        AND updated_at >= now() - interval '30 days')         AS churned_30d    -- 0
 *   FROM subscriptions;   -- (the un-gated old query read 1: a same-day-abandoned
 *                         --  checkout, expires_at NULL, updated_at bumped into window)
 *
 * Derived (in code, not SQL):
 *   PAID CONVERSION = paying_users (0) ÷ real_users (112)           = 0.00%
 *   MRR   = paying_users (0) × €19/mo (€114 ÷ 6-mo pass)            = €0/mo
 *   LTV   = €114 (one full pass per payer; no completed rows to avg) = €114
 *   COVERAGE = mean(currentL / 4) over the 8 registry processes      ≈ 21.9%
 *             (1×L0 + 7×L1 ⇒ ((0 + 7×1)/4)/8 = 1.75/8 = 0.21875)
 * ─────────────────────────────────────────────────────────────────────────
 */
export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const metrics = await computeControlPlaneMetrics(sb);
    return NextResponse.json(metrics);
  },
  {
    route: "/api/stats/admin/control-plane",
    rateLimit: { limit: 120, windowMs: 60_000 },
  }
);
