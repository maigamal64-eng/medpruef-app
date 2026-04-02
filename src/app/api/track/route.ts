import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

interface TrackEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface TrackPayload {
  sessionId: string;
  userId: string;
  events?: TrackEvent[];
  createSession?: boolean;
  endSession?: boolean;
  deviceInfo?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  try {
    const body: TrackPayload = await req.json();
    const { sessionId, userId, events, createSession, endSession, deviceInfo } = body;

    if (!userId || !sessionId) {
      return NextResponse.json({ error: "Missing userId or sessionId" }, { status: 400 });
    }

    const db = getServiceClient();

    // Create a new session record
    if (createSession) {
      await db.from("user_sessions").upsert(
        {
          id: sessionId,
          user_id: userId,
          device_info: deviceInfo || {},
          started_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    }

    // Mark session as ended
    if (endSession) {
      const { data: session } = await db
        .from("user_sessions")
        .select("started_at")
        .eq("id", sessionId)
        .single();

      const durationSeconds = session?.started_at
        ? Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000)
        : null;

      await db
        .from("user_sessions")
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: durationSeconds,
        })
        .eq("id", sessionId);
    }

    // Insert events batch
    if (events && events.length > 0) {
      const rows = events.map((e) => ({
        user_id: userId,
        session_id: sessionId,
        event_type: e.type,
        event_data: e.data || {},
        created_at: e.timestamp || new Date().toISOString(),
      }));

      await db.from("user_events").insert(rows);

      // Track pages_visited on page_view events
      const pageViews = events
        .filter((e) => e.type === "page_view" && e.data?.page)
        .map((e) => e.data.page as string);

      if (pageViews.length > 0) {
        const { data: session } = await db
          .from("user_sessions")
          .select("pages_visited")
          .eq("id", sessionId)
          .single();

        const existing: string[] = session?.pages_visited || [];
        const merged = Array.from(new Set([...existing, ...pageViews]));
        await db
          .from("user_sessions")
          .update({ pages_visited: merged })
          .eq("id", sessionId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/track]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
