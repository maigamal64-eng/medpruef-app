import { NextRequest, NextResponse } from "next/server";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { ICS_HEADERS, calendarFeedEnabled, parseFeedId, parseFeedLang, renderPublicFeed } from "@/lib/exam-calendar/feed";
import { logFeedFetch } from "@/lib/exam-calendar/feed-fetch-log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Public exam calendar feed (a-exam-calendar-feed): /api/calendar/<feed>.ics
 * with feed = all | sip4a | sip5a | stichprobentest | rezeptierkunde |
 * gerichtsmedizin, optional ?lang=de|en. Dates come only from
 * OFFICIAL_SITTINGS, no database read. With EXAM_CALENDAR_FEED_ENABLED off the
 * answer is a valid calendar with no events (never a 404: a subscribed
 * calendar then drops its old events instead of showing an error).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ feed: string }> }) {
  const { feed: raw } = await ctx.params;
  const feed = parseFeedId(raw);
  if (!feed) return NextResponse.json({ error: "Unknown feed" }, { status: 404 });
  if (!checkRateLimit({ key: rateKey("calendar-feed", callerIp(req)), limit: 30, windowMs: 60_000 }).allowed) {
    return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  }
  const lang = parseFeedLang(req.nextUrl.searchParams.get("lang"));
  const enabled = calendarFeedEnabled();
  const body = renderPublicFeed(feed, lang, enabled);
  if (enabled) {
    void logFeedFetch({ kind: "public", feed, ua: req.headers.get("user-agent"), throttleKey: `public:${feed}:${lang}` });
  }
  // Short edge cache, no long stale window: a kill switch or a corrected date must reach subscribers within minutes.
  const cache = enabled ? "public, max-age=0, s-maxage=600" : "no-store";
  return new NextResponse(body, { status: 200, headers: { ...ICS_HEADERS, "Cache-Control": cache } });
}
