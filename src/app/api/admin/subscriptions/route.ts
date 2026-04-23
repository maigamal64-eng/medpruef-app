import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();

    const [{ data: activeSubs }, { data: recent }] = await Promise.all([
      sb.from("subscriptions").select("tier, status, expires_at").eq("status", "active"),
      sb
        .from("subscriptions")
        .select("id, tier, status, started_at, amount_cents")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(50),
    ]);

    const now = Date.now();
    const byTier: Record<string, number> = {};
    let totalActive = 0;
    for (const row of activeSubs || []) {
      if (
        !row.expires_at ||
        new Date(row.expires_at as string).getTime() > now
      ) {
        const t = (row.tier as string) || "unknown";
        byTier[t] = (byTier[t] || 0) + 1;
        totalActive += 1;
      }
    }

    return NextResponse.json({
      total_active: totalActive,
      by_tier: byTier,
      recent: recent || [],
    });
  },
  { route: "/api/admin/subscriptions" }
);
