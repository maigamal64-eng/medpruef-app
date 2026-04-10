import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

interface UserRow {
  id: string;
  telegram_id: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  created_at: string;
  user_gamification: {
    total_xp: number;
    current_streak: number;
    total_questions_answered: number;
    total_correct: number;
  }[] | null;
}

export async function GET() {
  try {
    const db = getServiceClient();

    // Fetch users with their gamification data
    const { data: users, error: usersError } = await db
      .from("users")
      .select(
        `
        id,
        telegram_id,
        first_name,
        last_name,
        username,
        photo_url,
        created_at,
        user_gamification (
          total_xp,
          current_streak,
          total_questions_answered,
          total_correct
        )
      `
      )
      .order("created_at", { ascending: false });

    if (usersError) {
      console.error("[/api/stats/admin/users] usersError:", usersError);
      return NextResponse.json(
        { error: "Failed to fetch users" },
        { status: 500 }
      );
    }

    // Fetch the latest event per user for "last active"
    let latestEvents: { user_id: string; last_active: string }[] | null = null;
    let eventsError: { message: string } | null = null;
    try {
      const rpcResult = await db.rpc("get_latest_events_per_user");
      latestEvents = rpcResult.data as typeof latestEvents;
      eventsError = rpcResult.error;
    } catch {
      eventsError = { message: "RPC not found" };
    }

    // Build a lookup map for last_active
    const lastActiveMap: Record<string, string> = {};
    if (!eventsError && latestEvents) {
      for (const evt of latestEvents as { user_id: string; last_active: string }[]) {
        lastActiveMap[evt.user_id] = evt.last_active;
      }
    }

    // If RPC is not available, fall back to fetching events manually
    if (eventsError || !latestEvents) {
      const { data: events } = await db
        .from("user_events")
        .select("user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (events) {
        for (const evt of events) {
          const uid = evt.user_id as string;
          if (!lastActiveMap[uid]) {
            lastActiveMap[uid] = evt.created_at as string;
          }
        }
      }
    }

    // Map to clean response
    const result = (users as UserRow[]).map((u) => {
      const gam = u.user_gamification?.[0] || null;
      const questionsAnswered = gam?.total_questions_answered || 0;
      const totalCorrect = gam?.total_correct || 0;
      const accuracy =
        questionsAnswered > 0
          ? Math.round((totalCorrect / questionsAnswered) * 100)
          : 0;

      return {
        id: u.id,
        telegram_id: u.telegram_id,
        name:
          [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Anonymous",
        username: u.username,
        photo_url: u.photo_url,
        created_at: u.created_at,
        xp: gam?.total_xp || 0,
        streak: gam?.current_streak || 0,
        questions_answered: questionsAnswered,
        accuracy,
        last_active: lastActiveMap[u.id] || u.created_at,
      };
    });

    // Sort by last_active desc
    result.sort(
      (a, b) =>
        new Date(b.last_active).getTime() - new Date(a.last_active).getTime()
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/stats/admin/users]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
