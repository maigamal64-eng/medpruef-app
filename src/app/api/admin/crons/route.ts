import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const since = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data, error } = await sb
      .from("cron_runs")
      .select("id, cron_name, started_at, finished_at, status, rows_affected, error")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ items: data || [] });
  },
  { route: "/api/admin/crons" }
);
