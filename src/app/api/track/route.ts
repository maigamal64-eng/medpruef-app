import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

// Max events accepted per POST. Prevents a malicious client from
// stuffing the events table with a single 10MB request. Anything
// over this is rejected with 413 (Backend audit BE-P1-13).
const MAX_EVENTS_PER_BATCH = 500;

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
    if (Array.isArray(events) && events.length > MAX_EVENTS_PER_BATCH) {
      return NextResponse.json(
        { error: `events[] max ${MAX_EVENTS_PER_BATCH}` },
        { status: 413 },
      );
    }

    const db = getServiceClient();
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

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

      // Log session start in activity log
      const isUuid = /^[0-9a-f]{8}-/.test(userId);
      if (isUuid) {
        await db.from("user_activity_log").insert({
          user_id: userId,
          session_id: sessionId,
          event_type: "session_start",
          action: "create_session",
          metadata: { device_info: deviceInfo || {} },
          ip_address: ip,
          user_agent: ua,
        }).then(() => {});
      }
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

    // Insert events batch. Errors are now surfaced in the response
    // via a non-OK status, which lets the client-side tracker
    // re-queue and retry. Previously the inserts were fire-and-
    // forget and silently dropped rows on failure (Analytics audit
    // P0-A2, Backend audit BE-P0-002).
    if (events && events.length > 0) {
      // Original user_events table
      const rows = events.map((e) => ({
        user_id: userId,
        session_id: sessionId,
        event_type: e.type,
        event_data: e.data || {},
        created_at: e.timestamp || new Date().toISOString(),
      }));
      const { error: eventsErr } = await db.from("user_events").insert(rows);
      if (eventsErr) {
        captureServerError(eventsErr, {
          route: "/api/track",
          userId,
          phase: "user_events-insert",
          batchSize: rows.length,
        });
        return NextResponse.json(
          { error: "Failed to record events", code: "TRACK_INSERT_FAILED" },
          { status: 500, headers: { "x-track-failed": "1" } },
        );
      }

      // Enhanced activity log (only for real UUID users, not guest_xxx)
      const isUuid = /^[0-9a-f]{8}-/.test(userId);
      if (isUuid) {
        const activityRows = events.map((e) => ({
          user_id: userId,
          session_id: sessionId,
          event_type: e.type,
          page: (e.data?.page as string) || null,
          component: (e.data?.component as string) || null,
          action: (e.data?.action as string) || e.type,
          metadata: e.data || {},
          question_id: (e.data?.questionId as number) || null,
          topic: (e.data?.topic as string) || null,
          duration_ms: (e.data?.timeSpent as number) || (e.data?.timeSpentMs as number) || null,
          ip_address: ip,
          user_agent: ua,
        }));
        const { error: activityErr } = await db
          .from("user_activity_log")
          .insert(activityRows);
        // Activity log failure is non-critical (user_events is the
        // authoritative stream) but we still ship it to Sentry so a
        // sustained breakage shows up as a cluster.
        if (activityErr) {
          captureServerError(activityErr, {
            route: "/api/track",
            userId,
            phase: "activity_log-insert",
            batchSize: activityRows.length,
          });
        }
      }

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
    captureServerError(err, { route: "/api/track" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
