import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { computePaymentFunnelMetrics } from "@/lib/admin/paymentFunnelMetrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/admin/payments — the read-only payment-funnel observability
 * behind /admin/payments (Gate 1, 2026-06-24).
 *
 * Guarded by adminRouteShell (requireAdmin + per-admin rate limit), same as
 * /api/stats/admin/control-plane. All computation is read-only — see
 * paymentFunnelMetrics.ts. Surfaces the funnel counts (checkout started →
 * redirected → webhook received → granted), the named failure reasons, the
 * Whop inbound-delivery truth from webhook_attempts (so a WHOP_WEBHOOK_SECRET
 * mismatch — every payment rejected at the door — is visible, not swallowed),
 * and the recent payment-events feed.
 */
export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const metrics = await computePaymentFunnelMetrics(sb);
    return NextResponse.json(metrics);
  },
  {
    route: "/api/stats/admin/payments",
    rateLimit: { limit: 120, windowMs: 60_000 },
  }
);
