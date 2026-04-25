import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit-log/latest?limit=10
 *
 * Returns the top-N most recent `admin_audit_log` rows. Used by the
 * post-audit-rescue integration test to assert an audit row landed
 * after a mutation, and by the /admin/overview header to surface
 * today's action count + the latest action's age.
 *
 * The broader admin audit page continues to use /api/admin/audit
 * (filterable by actor + action). This endpoint intentionally returns
 * a small, recent slice so the header and tests stay cheap.
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    const sb = getServiceClient();
    const url = new URL(req.url);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10) || 10)
    );

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const [latestRes, todayCountRes] = await Promise.all([
      sb
        .from("admin_audit_log")
        .select(
          "id, actor_id, actor_email, action, target_type, target_id, payload, ip_address, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(limit),
      sb
        .from("admin_audit_log")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since.toISOString()),
    ]);

    if (latestRes.error) {
      return NextResponse.json(
        { error: latestRes.error.message },
        { status: 500 }
      );
    }

    const items = latestRes.data || [];
    const latest = items[0] || null;
    return NextResponse.json({
      items,
      today_count: todayCountRes.count || 0,
      last_action_at: latest ? latest.created_at : null,
      last_action: latest ? latest.action : null,
    });
  },
  { route: "/api/admin/audit-log/latest" }
);
