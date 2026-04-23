"use client";

/**
 * useAdminRealtime — minimal Realtime subscription hook for admin tiles.
 *
 * §2.3 of the April 23 admin revamp sprint.
 *
 * Contract:
 * - Subscribes to postgres_changes on a single whitelisted table (+optional filter).
 * - Returns the latest payload.new (or the initialValue if nothing has landed yet).
 * - Returns lastUpdated, a Date that ticks every time an event lands.
 * - Returns isConnected (true once the channel is SUBSCRIBED, false on errors / CLOSED).
 *
 * Philosophy: this hook is intentionally small. Tiles that need rollups
 * (counts, sums) read their initial value from /api/admin/overview and
 * bump counters locally in response to Realtime events. Keeps the
 * websocket footprint minimal and avoids N queries per insert.
 */

import { useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export type RealtimeTable =
  | "subscriptions"
  | "user_feedback"
  | "referrals"
  | "exam_attempts"
  | "processed_webhook_events"
  | "waitlist"
  | "user_events"
  | "admin_audit_log"
  | "jobs"
  | "cron_runs";

export interface UseAdminRealtimeResult<T> {
  data: T | undefined;
  lastUpdated: Date;
  isConnected: boolean;
  /** Raw payload from the most recent event (insert/update/delete). */
  lastEvent: RealtimePostgresChangesPayload<Record<string, unknown>> | null;
}

export interface UseAdminRealtimeOptions<T> {
  /** Optional PostgREST-style filter, e.g. `status=eq.active`. */
  filter?: string;
  /** Initial value for `data`. Usually the SSR-fetched snapshot. */
  initialValue?: T;
  /**
   * Callback invoked on every change event. Use this to bump counters,
   * prepend rows to a list, etc. Receives the raw payload so callers
   * can discriminate between eventType 'INSERT' / 'UPDATE' / 'DELETE'.
   */
  onEvent?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

export function useAdminRealtime<T = unknown>(
  table: RealtimeTable,
  options: UseAdminRealtimeOptions<T> = {}
): UseAdminRealtimeResult<T> {
  const { filter, initialValue, onEvent } = options;
  const [data, setData] = useState<T | undefined>(initialValue);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] =
    useState<RealtimePostgresChangesPayload<Record<string, unknown>> | null>(null);

  // Keep the callback stable across renders so the channel doesn't
  // re-subscribe every time the parent re-renders. We mutate the ref
  // instead of re-binding the listener.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const sb = getBrowserSupabase();
    const channelKey = `admin:${table}:${filter ?? "all"}`;
    const channel: RealtimeChannel = sb.channel(channelKey);

    (channel as unknown as {
      on: (
        type: string,
        config: Record<string, unknown>,
        handler: (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
      ) => RealtimeChannel;
    }).on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
        setLastEvent(payload);
        setLastUpdated(new Date());
        // Propagate the most recent row data so tiles that want the
        // raw record don't have to do their own diffing. For DELETE
        // events, payload.new is empty; callers should use onEvent
        // and discriminate.
        if (payload.eventType !== "DELETE" && payload.new) {
          setData(payload.new as T);
        }
        onEventRef.current?.(payload);
      }
    );

    channel.subscribe((status) => {
      setIsConnected(status === "SUBSCRIBED");
    });

    return () => {
      sb.removeChannel(channel);
    };
    // onEvent is intentionally omitted — read via ref so swapping
    // callbacks doesn't tear down the subscription.
  }, [table, filter]);

  return { data, lastUpdated, isConnected, lastEvent };
}
