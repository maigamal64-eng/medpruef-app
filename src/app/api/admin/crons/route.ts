import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const since = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data, error, count } = await sb
      .from("cron_runs")
      .select("id, cron_name, started_at, finished_at, status, rows_affected, error", { count: "exact" })
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500);
    if (error) {
      return adminErrorResponse(error, "/api/admin/crons");
    }
    // UX-ADM-34: the page prints "Showing N of M" instead of cutting silently.
    return NextResponse.json({ items: data || [], total: count ?? null, window_hours: 48 });
  },
  { route: "/api/admin/crons" }
);
