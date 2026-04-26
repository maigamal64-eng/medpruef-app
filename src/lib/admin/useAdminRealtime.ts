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
 *
 * 2026-04-26 — review-2026-04-26-B2:
 * Sentry caught `cannot add postgres_changes callbacks for
 * realtime:admin:subscriptions:all after subscribe()` again post-PR-#7.
 * Root cause hypothesis: a tab left open across a deploy still held a
 * subscribed channel with the same name. We now (a) use crypto.randomUUID()
 * for the instance suffix instead of useId() (cryptographically unique
 * across reloads, hot-reloads, and multi-tab same-name collisions),
 * (b) emit a Sentry breadcrumb whenever a channel is created so the
 * order is auditable in future incidents, and (c) wrap the .on()
 * registration in a guard that swallows + warns if Supabase ever
 * complains about the order.
 */

import { useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { addBreadcrumb } from "@/lib/sentry-capture";

function genInstanceId(): string {
  // crypto.randomUUID is widely supported (all evergreen browsers).
  // Fallback to Math.random for ancient runtimes.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

  // Per-instance unique id — see module-level comment about why
  // useId() wasn't enough. We mint once per mount via a ref so HMR
  // / re-renders never race with the subscription teardown.
  const instanceIdRef = useRef<string>("");
  if (!instanceIdRef.current) {
    instanceIdRef.current = genInstanceId();
  }

  useEffect(() => {
    const sb = getBrowserSupabase();
    // The instanceId guarantees the channel name is unique to THIS
    // component invocation. We still encode the table + filter so the
    // name is human-readable in dev tools.
    const channelKey = `admin:${table}:${filter ?? "all"}:${instanceIdRef.current}`;
    addBreadcrumb({
      category: "realtime",
      message: "channel_created",
      data: { channelKey, table, filter: filter ?? null },
    });
    const channel: RealtimeChannel = sb.channel(channelKey);

    // Order is sacred: every `.on()` MUST be called before
    // `.subscribe()`. We attach the postgres_changes handler first,
    // then call subscribe exactly once at the end.
    try {
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
      addBreadcrumb({
        category: "realtime",
        message: "on_registered",
        data: { channelKey },
      });
    } catch (err) {
      // Should be impossible because we just created the channel and
      // call .on() immediately. But if Supabase ever changes the
      // contract again, swallow + warn so a single subscriber can't
      // crash the whole admin page.
      addBreadcrumb({
        category: "realtime",
        message: "on_failed",
        level: "error",
        data: {
          channelKey,
          error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        },
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[useAdminRealtime] .on() failed for ${channelKey}`,
        err,
      );
    }

    channel.subscribe((status) => {
      setIsConnected(status === "SUBSCRIBED");
      addBreadcrumb({
        category: "realtime",
        message: "subscribe_status",
        data: { channelKey, status },
      });
    });

    return () => {
      sb.removeChannel(channel);
    };
    // onEvent is intentionally omitted — read via ref so swapping
    // callbacks doesn't tear down the subscription.
  }, [table, filter]);

  return { data, lastUpdated, isConnected, lastEvent };
}
