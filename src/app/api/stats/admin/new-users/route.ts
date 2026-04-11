import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

/**
 * Live new-users tracker for the admin dashboard.
 *
 * Returns registration counts at multiple time windows plus the 10 most
 * recent signups so the admin can watch users come in once outreach starts.
 *
 * The admin dashboard polls this every 30s.
 */
export async function GET() {
  try {
    const db = getServiceClient();
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

    const [hourRes, todayRes, weekRes, monthRes, recentRes, totalRes] =
      await Promise.all([
        db
          .from("users")
          .select("id", { count: "exact", head: true })
          .gte("created_at", oneHourAgo),
        db
          .from("users")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayStart.toISOString()),
        db
          .from("users")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
        db
          .from("users")
          .select("id", { count: "exact", head: true })
          .gte("created_at", thirtyDaysAgo),
        db
          .from("users")
          .select("id, email, first_name, last_name, telegram_username, tier, created_at")
          .order("created_at", { ascending: false })
          .limit(10),
        db.from("users").select("id", { count: "exact", head: true }),
      ]);

    return NextResponse.json({
      lastHour: hourRes.count || 0,
      today: todayRes.count || 0,
      lastSevenDays: weekRes.count || 0,
      lastThirtyDays: monthRes.count || 0,
      total: totalRes.count || 0,
      recent: recentRes.data || [],
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error("[/api/stats/admin/new-users]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
