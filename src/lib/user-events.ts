/**
 * Centralized helper for inserting analytics rows into `user_events`.
 *
 * Why this module exists (review-2026-04-26-B1):
 *
 * Sentry has been getting `user_events_user_id_fkey` violation errors
 * surfaced through `captureServerError`. The signal is real (a row
 * tried to insert with a user_id that doesn't exist in users) — but
 * a 500 because of an analytics row failing is the worst kind of
 * tail dependency: it kills the actual user-facing operation
 * (checkout, AI chat, webhook processing) for the sake of telemetry.
 *
 * We also had a parallel disaster on `event_type='ai_chat_completed'`
 * where the insert used `metadata: {...}` but the schema column is
 * `event_data` — silent 22P02 errors swallowed by every site's
 * `try { ... } catch {}`, admin tile read 0/0 for a full day.
 *
 * `recordEventSafe()` solves both: it normalizes the field name to
 * `event_data`, swallows FK + invalid-syntax errors with a
 * `console.warn` and a Sentry breadcrumb (NOT capture), and never
 * throws into the calling request handler. The helper is the ONLY
 * way to write to user_events from now on — direct `.insert()` calls
 * to that table are deprecated.
 *
 * Usage:
 *   await recordEventSafe(sb, {
 *     userId,
 *     eventType: "ai_chat_completed",
 *     data: { provider, duration_ms },
 *   });
 *
 * Returns `{ ok: boolean, reason?: 'fk_violation' | 'unknown' | 'noop' }`.
 * `noop` fires when userId is null (e.g. anonymous tracking) — we
 * don't write rows we can't tie to a user.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { addBreadcrumb } from "@/lib/sentry-capture";
import { analyticsWritesDisabled } from "@/lib/supabase-resilience";

export interface RecordEventArgs {
  userId: string | null;
  eventType: string;
  data?: Record<string, unknown>;
  /** Optional session_id (uuid). Skip if you don't have it; the FK on
   *  session_id is on user_sessions(id), not on users(id). */
  sessionId?: string | null;
}

export type RecordEventResult =
  | { ok: true }
  | { ok: false; reason: "fk_violation" | "invalid_input" | "unknown" | "noop" };

/**
 * Best-effort insert into user_events. Never throws. Always swallows
 * FK + 22P02 errors so analytics noise can't take down a user request.
 */
export async function recordEventSafe(
  sb: SupabaseClient,
  args: RecordEventArgs,
): Promise<RecordEventResult> {
  if (analyticsWritesDisabled()) {
    return { ok: false, reason: "noop" };
  }
  if (!args.userId) {
    return { ok: false, reason: "noop" };
  }
  try {
    const row: Record<string, unknown> = {
      user_id: args.userId,
      event_type: args.eventType,
    };
    if (args.data !== undefined) row.event_data = args.data;
    if (args.sessionId) row.session_id = args.sessionId;

    const { error } = await sb.from("user_events").insert(row);
    if (!error) return { ok: true };

    // Postgres FK violation. Common causes: a guest analytics event
    // POSTed for a UUID that was never persisted, or a deleted-user
    // residual.
    if (error.code === "23503") {
      addBreadcrumb({
        category: "user_events",
        message: "fk_violation_swallowed",
        level: "warning",
        data: {
          eventType: args.eventType,
          userId: args.userId,
          constraint: error.message.slice(0, 200),
        },
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[user_events] FK violation swallowed for event_type=${args.eventType}`,
        { userId: args.userId, message: error.message.slice(0, 150) },
      );
      return { ok: false, reason: "fk_violation" };
    }
    // 22P02 — invalid input (e.g. malformed UUID, wrong column name).
    if (error.code === "22P02" || error.code === "42703") {
      addBreadcrumb({
        category: "user_events",
        message: "invalid_input_swallowed",
        level: "error",
        data: {
          eventType: args.eventType,
          userId: args.userId,
          code: error.code,
          message: error.message.slice(0, 200),
        },
      });
      // eslint-disable-next-line no-console
      console.error(
        `[user_events] schema mismatch swallowed for event_type=${args.eventType}`,
        { code: error.code, message: error.message.slice(0, 200) },
      );
      return { ok: false, reason: "invalid_input" };
    }
    // Anything else — log a breadcrumb but don't block.
    addBreadcrumb({
      category: "user_events",
      message: "unknown_error_swallowed",
      level: "warning",
      data: {
        eventType: args.eventType,
        userId: args.userId,
        code: error.code,
        message: error.message.slice(0, 200),
      },
    });
    return { ok: false, reason: "unknown" };
  } catch (err) {
    // Network / Supabase client-level exception. Log + bail.
    addBreadcrumb({
      category: "user_events",
      message: "exception_swallowed",
      level: "error",
      data: {
        eventType: args.eventType,
        userId: args.userId,
        message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      },
    });
    return { ok: false, reason: "unknown" };
  }
}
