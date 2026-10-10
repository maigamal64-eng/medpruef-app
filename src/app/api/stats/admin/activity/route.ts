import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(async ({ req }) => {
  try {
    const db = getServiceClient();
    const url = new URL(req.url);
    const userId = url.searchParams.get("userId");
    const eventType = url.searchParams.get("eventType");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    let query = db
      .from("user_activity_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq("user_id", userId);
    if (eventType) query = query.eq("event_type", eventType);

    const { data, count, error } = await query;

    if (error) {
      console.error("[/api/stats/admin/activity]", error);
      return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 });
    }

    // Get distinct event types for filtering
    const { data: eventTypes } = await db
      .from("user_activity_log")
      .select("event_type")
      .limit(1000);

    const uniqueTypes = [...new Set((eventTypes || []).map((e: { event_type: string }) => e.event_type))].sort();

    return NextResponse.json({
      activities: data || [],
      total: count || 0,
      eventTypes: uniqueTypes,
    });
  } catch (err) {
    console.error("[/api/stats/admin/activity]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { route: "/api/stats/admin/activity", rateLimit: { limit: 120, windowMs: 60_000 } });
