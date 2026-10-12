import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { computeGrowthMetrics } from "@/lib/admin/growthMetrics";
import { parseGrowthWindow } from "@/lib/admin/growth-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/stats/admin/growth?window=7|30|90|all — the GROWTH FUNNEL behind
 * /admin/growth (AUTONOMY.md F-08).
 *
 * Guarded by adminRouteShell (requireAdmin + revenue.read + per-admin rate
 * limit). All computation is read-only (SELECT/count only); see
 * growthMetrics.ts for the cohort funnel, the Sources table and how "engaged"
 * is counted without tripping the 1000-row REST cap (per-user HEAD count).
 * The `paying` step uses the shared real-paying rule (./money-rules), so it
 * agrees with Today and Payments. Counts only: no learner identity leaves.
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    const sb = getServiceClient();
    // ?window=7|30|90|all (a20, ADM-18 A); anything else is the 30-day cohort.
    const window = parseGrowthWindow(new URL(req.url).searchParams.get("window"));
    const metrics = await computeGrowthMetrics(sb, window);
    return NextResponse.json(metrics);
  },
  {
    route: "/api/stats/admin/growth",
    rateLimit: { limit: 120, windowMs: 60_000 },
  }
);
