import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/admin — dashboard overview
 *
 * 2026-04-15 audit findings addressed here:
 *
 *   - BE-P1-008 / Analytics P0-A3: previously this route issued 9
 *     parallel unfiltered user_events SELECTs and counted unique
 *     users in JavaScript. Supabase's REST layer silently caps at
 *     1000 rows, so DAU/WAU/MAU started under-reporting as soon as
 *     the 30-day event window crossed 1000 rows — and it already
 *     was (ground-truth verified 7351 user_events rows in DB).
 *
 *   - Fix: two SECURITY DEFINER SQL RPCs (see migration
 *     20260415_admin_stats_rpc) aggregate server-side:
 *       get_admin_overview_counts()  →  one row with total_users,
 *         dau, wau, mau, questions_today, questions_this_week
 *       get_admin_daily_active_users(days_back int) → one row per
 *         day for the line chart.
 *
 *   - Accuracy-by-topic and peak-study-hours still need the raw
 *     question_answer event rows from the last 30 days because
 *     the aggregation key (topic + isCorrect) lives in event_data
 *     JSONB. These still use a raw fetch, but capped at 5000 rows
 *     with an explicit .range() so the truncation is visible and
 *     bounded. A proper fix would move the topic/accuracy rollup
 *     into a materialized view or daily_stats.
 */
export const GET = adminRouteShell(async () => {
  try {
    const db = getServiceClient();
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    // Server-side aggregates — correct at any volume.
    const [overviewRes, dailyRes, topicRawRes, hoursRawRes] = await Promise.all([
      db.rpc("get_admin_overview_counts"),
      db.rpc("get_admin_daily_active_users", { days_back: 30 }),
      // Topic + accuracy — still raw-row because the aggregation
      // key is a JSONB path. Bounded at 5000 rows for safety.
      db
        .from("user_events")
        .select("event_data")
        .eq("event_type", "question_answer")
        .gte("created_at", monthAgo)
        .range(0, 4999),
      // Peak hours — raw timestamps, same bounding.
      db
        .from("user_events")
        .select("created_at")
        .eq("event_type", "question_answer")
        .gte("created_at", monthAgo)
        .range(0, 4999),
    ]);

    if (overviewRes.error) {
      console.error("[/api/stats/admin] overview rpc:", overviewRes.error);
      return NextResponse.json({ error: "Overview RPC failed" }, { status: 500 });
    }

    const overview = (overviewRes.data?.[0] as Record<string, number> | undefined) || {};
    const totalUsers = Number(overview.total_users) || 0;
    const dau = Number(overview.dau) || 0;
    const wau = Number(overview.wau) || 0;
    const mau = Number(overview.mau) || 0;
    const questionsToday = Number(overview.questions_today) || 0;
    const questionsThisWeek = Number(overview.questions_this_week) || 0;

    // Accuracy by topic
    const topicMap: Record<string, { total: number; correct: number }> = {};
    for (const row of (topicRawRes.data as { event_data: Record<string, unknown> }[]) || []) {
      const d = row.event_data || {};
      const topic = (d.topic as string) || "Unknown";
      const isCorrect = !!d.isCorrect;
      if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0 };
      topicMap[topic].total += 1;
      if (isCorrect) topicMap[topic].correct += 1;
    }
    const avgAccuracyByTopic = Object.entries(topicMap).map(([topic, v]) => ({
      topic,
      accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
      total: v.total,
    }));

    const topTopics = [...avgAccuracyByTopic]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    const weakTopics = [...avgAccuracyByTopic]
      .filter((t) => t.total >= 5)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5);

    // Peak study hours (0–23)
    const hourCounts: number[] = new Array(24).fill(0);
    for (const row of (hoursRawRes.data as { created_at: string }[]) || []) {
      const h = new Date(row.created_at).getHours();
      hourCounts[h] += 1;
    }
    const peakStudyHours = hourCounts.map((count, hour) => ({ hour, count }));

    // Daily active users from the RPC — filled into a 30-day array
    const dailyFromRpc = (dailyRes.data as { day: string; active: number }[] | null) || [];
    const dailyMap = new Map<string, number>();
    for (const row of dailyFromRpc) {
      dailyMap.set(row.day, Number(row.active) || 0);
    }
    const now = new Date();
    const dailyActiveUsers = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getTime() - (29 - i) * 86400000);
      const day = d.toISOString().slice(0, 10);
      return { date: day, users: dailyMap.get(day) || 0 };
    });

    return NextResponse.json({
      totalUsers,
      dau,
      wau,
      mau,
      questionsToday,
      questionsThisWeek,
      avgAccuracyByTopic,
      topTopics,
      weakTopics,
      peakStudyHours,
      dailyActiveUsers,
    });
  } catch (err) {
    console.error("[/api/stats/admin]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}, { route: "/api/stats/admin", rateLimit: { limit: 120, windowMs: 60_000 } });
