import { getServiceClient } from "@/lib/supabase";
import { analyticsWritesDisabled } from "@/lib/supabase-resilience";
import { dbRecentlyUnavailable } from "@/lib/db-unavailable";
import { afterResponse } from "@/lib/after-response";
import { uaClass } from "@/lib/analytics-events";

/**
 * Feed fetch counts (a-exam-calendar-feed). One user_activity_log row per
 * (feed, hour, instance) for public feeds and per (account, hour, instance)
 * for personal feeds: calendar apps poll every few hours, so this is a
 * "subscribers reached in the hour" count, not raw requests. event_type is
 * `calendar_feed_fetch`; metadata {kind, feed, agent, ua_class}. No token, no
 * address and no account id (user_id stays null on purpose).
 */
const seen = new Map<string, number>();
const HOUR = 3_600_000;

export function calendarAgent(ua: string | null): "google" | "apple" | "outlook" | "other" {
  const u = ua ?? "";
  if (/google/i.test(u)) return "google";
  if (/dataaccessd|iOS|macOS|CalendarAgent|Darwin/i.test(u)) return "apple";
  if (/outlook|microsoft/i.test(u)) return "outlook";
  return "other";
}

export function shouldLogFetch(key: string, now = Date.now()): boolean {
  if (seen.size > 5000) seen.clear();
  const last = seen.get(key);
  if (last !== undefined && now - last < HOUR) return false;
  seen.set(key, now);
  return true;
}

export function logFeedFetch(opts: { kind: "public" | "personal"; feed: string; userId?: string; ua: string | null; throttleKey: string }): Promise<void> {
  if (analyticsWritesDisabled() || dbRecentlyUnavailable() || !shouldLogFetch(opts.throttleKey)) return Promise.resolve();
  return afterResponse("calendar-feed-fetch", async () => {
    await getServiceClient().from("user_activity_log").insert({
      // Never the account id: a calendar app polling by itself must not read as learner activity (ops_growth_summary counts any user_activity_log row).
      user_id: null,
      session_id: "calendar-feed",
      event_type: "calendar_feed_fetch",
      page: "/api/calendar",
      action: "calendar_feed_fetch",
      metadata: { kind: opts.kind, feed: opts.feed, agent: calendarAgent(opts.ua), ua_class: uaClass(opts.ua) },
    });
  });
}
