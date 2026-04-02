import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function GET() {
  try {
    const db = getServiceClient();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

    // Run all queries in parallel
    const [
      totalUsersRes,
      dauRes,
      wauRes,
      mauRes,
      questionsTodayRes,
      questionsWeekRes,
      accuracyByTopicRes,
      peakHoursRes,
      dailyActiveRes,
    ] = await Promise.all([
      // Total distinct users ever
      db.from("user_events").select("user_id", { count: "exact", head: false }),

      // DAU — distinct users with events today
      db
        .from("user_events")
        .select("user_id")
        .gte("created_at", todayStr),

      // WAU
      db
        .from("user_events")
        .select("user_id")
        .gte("created_at", weekAgo),

      // MAU
      db
        .from("user_events")
        .select("user_id")
        .gte("created_at", monthAgo),

      // Questions answered today
      db
        .from("user_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "question_answer")
        .gte("created_at", todayStr),

      // Questions answered this week
      db
        .from("user_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "question_answer")
        .gte("created_at", weekAgo),

      // Accuracy by topic — from question_answer events with isCorrect & topic
      db
        .from("user_events")
        .select("event_data")
        .eq("event_type", "question_answer")
        .gte("created_at", monthAgo),

      // Peak study hours — extract hour from created_at for question_answer events
      db
        .from("user_events")
        .select("created_at")
        .eq("event_type", "question_answer")
        .gte("created_at", monthAgo),

      // Daily active users for last 30 days
      db
        .from("user_events")
        .select("user_id, created_at")
        .gte("created_at", monthAgo)
        .order("created_at", { ascending: true }),
    ]);

    // Total unique users
    const allUsers = totalUsersRes.data || [];
    const totalUsers = new Set(allUsers.map((r: { user_id: string }) => r.user_id)).size;

    // DAU / WAU / MAU
    const dauData = dauRes.data || [];
    const wauData = wauRes.data || [];
    const mauData = mauRes.data || [];
    const dau = new Set(dauData.map((r: { user_id: string }) => r.user_id)).size;
    const wau = new Set(wauData.map((r: { user_id: string }) => r.user_id)).size;
    const mau = new Set(mauData.map((r: { user_id: string }) => r.user_id)).size;

    // Questions counts
    const questionsToday = questionsTodayRes.count || 0;
    const questionsThisWeek = questionsWeekRes.count || 0;

    // Accuracy by topic
    const topicMap: Record<string, { total: number; correct: number }> = {};
    for (const row of accuracyByTopicRes.data || []) {
      const d = row.event_data as Record<string, unknown>;
      const topic = (d?.topic as string) || "Unknown";
      const isCorrect = !!d?.isCorrect;
      if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0 };
      topicMap[topic].total += 1;
      if (isCorrect) topicMap[topic].correct += 1;
    }
    const avgAccuracyByTopic = Object.entries(topicMap).map(([topic, v]) => ({
      topic,
      accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 100) : 0,
      total: v.total,
    }));

    // Top and weak topics (by volume and accuracy)
    const topTopics = [...avgAccuracyByTopic]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    const weakTopics = [...avgAccuracyByTopic]
      .filter((t) => t.total >= 5)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5);

    // Peak study hours (0–23)
    const hourCounts: number[] = new Array(24).fill(0);
    for (const row of peakHoursRes.data || []) {
      const h = new Date(row.created_at).getHours();
      hourCounts[h] += 1;
    }
    const peakStudyHours = hourCounts.map((count, hour) => ({ hour, count }));

    // Daily active users — last 30 days chart
    const dailyMap: Record<string, Set<string>> = {};
    for (const row of dailyActiveRes.data || []) {
      const day = (row.created_at as string).slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = new Set();
      dailyMap[day].add(row.user_id as string);
    }
    const dailyActiveUsers = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getTime() - (29 - i) * 86400000);
      const day = d.toISOString().slice(0, 10);
      return { date: day, users: dailyMap[day]?.size || 0 };
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
}
