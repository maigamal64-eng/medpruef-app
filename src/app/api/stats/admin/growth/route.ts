import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { computeGrowthMetrics } from "@/lib/admin/growthMetrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/admin/growth — the GROWTH FUNNEL behind /admin/growth
 * (Autonomy Control Plane, AUTONOMY.md F-08).
 *
 * Guarded by adminRouteShell (requireAdmin + per-admin rate limit) exactly like
 * the control-plane route — it goes THROUGH the audited shell, it does not
 * bypass it. All computation is read-only (SELECT/count only); see
 * growthMetrics.ts for the funnel definitions and, in particular, how "engaged"
 * is counted without tripping the 1000-row REST cap (per-user HEAD count).
 *
 * Growth owns reach/funnel (signups → activated → engaged → paying); euros
 * (MRR, conversion, churn, LTV) stay on /api/stats/admin/control-plane. The
 * `paying` step here uses the SAME real-paying computation as control-plane's
 * active_paid_users, so the two panels agree.
 */
export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const metrics = await computeGrowthMetrics(sb);
    return NextResponse.json(metrics);
  },
  {
    route: "/api/stats/admin/growth",
    rateLimit: { limit: 120, windowMs: 60_000 },
  }
);
