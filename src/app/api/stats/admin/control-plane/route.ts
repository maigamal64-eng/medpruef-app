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
 * VERIFIED SQL (run read-only against prod xfgllbkpgbginbjikjbb, 2026-06-23).
 * The Supabase JS calls in computeControlPlaneMetrics() are the typed
 * equivalents of these; kept here as the human-auditable source of the math.
 *
 *   -- paid conversion + paying base
 *   SELECT
 *     count(*)                                          AS total_users,        -- 114
 *     count(*) FILTER (WHERE tier='pro')                AS pro_users,          -- 2
 *     count(*) FILTER (WHERE tier='pro'
 *        AND (tier_expires_at IS NULL
 *             OR tier_expires_at > now()))              AS pro_entitled_now,   -- 1
 *     round((count(*) FILTER (WHERE tier='pro')::numeric
 *            / NULLIF(count(*),0)) * 100, 2)            AS paid_conversion_pct -- 1.75
 *   FROM users;
 *
 *   -- subscription reconciliation + churn
 *   SELECT
 *     count(*) FILTER (WHERE status='active')           AS active_subs_rows,   -- 0
 *     count(*) FILTER (WHERE status IN ('cancelled','refunded','expired')
 *        AND updated_at >= now() - interval '30 days')  AS churned_30d         -- 1
 *   FROM subscriptions;
 *
 * Derived (in code, not SQL):
 *   MRR   = pro_entitled_now (1) × €19/mo (€114 ÷ 6-mo pass)        = €19/mo
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
