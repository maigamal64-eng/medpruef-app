import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { computePaymentFunnelMetrics } from "@/lib/admin/paymentFunnelMetrics";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/stats/admin/payments — the read-only data behind /admin/payments.
 *
 * Guarded by adminRouteShell (revenue.read via the permission map). Returns
 * the shared payment diagnosis, cash money in per Vienna month, the distinct
 * funnel, the Unresolved payments queue, refunds with access outcome and the
 * webhook deliveries (a14, ADM-01/ADM-02). Learner names and emails are
 * included only when the viewer also holds users.read.
 */
export const GET = adminRouteShell(
  async ({ actor }) => {
    const snapshot = await loadAdminPermissionSnapshot(actor.userId);
    const sb = getServiceClient();
    const metrics = await computePaymentFunnelMetrics(sb, {
      canReadUsers: canAccessAdminPermission(snapshot, "users.read"),
    });
    return NextResponse.json(metrics);
  },
  {
    route: "/api/stats/admin/payments",
    rateLimit: { limit: 120, windowMs: 60_000 },
  }
);
