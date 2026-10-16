import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callerIp, checkRateLimit, rateKey } from "@/lib/rate-limit";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { readCalendarFeedToken } from "@/lib/reminders/tokens";
import { ICS_HEADERS, calendarFeedEnabled, parseFeedLang, renderPersonalFeed } from "@/lib/exam-calendar/feed";
import { logFeedFetch } from "@/lib/exam-calendar/feed-fetch-log";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * Personal feed: /api/calendar/u/<signed token>.ics. The token names only the
 * account; the feed holds official dates for the learner's own sitting and a
 * plain link back to /study-plan, nothing else. A database stall answers 503
 * (a calendar app keeps its old events), never an empty calendar.
 */
async function handleGET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token: raw } = await ctx.params;
  if (!checkRateLimit({ key: rateKey("calendar-feed-me", callerIp(req)), limit: 30, windowMs: 60_000 }).allowed) {
    return new NextResponse("Too many requests", { status: 429, headers: { "Retry-After": "60", ...NO_STORE } });
  }
  const lang = parseFeedLang(req.nextUrl.searchParams.get("lang"));
  const enabled = calendarFeedEnabled();
  let parsed: ReturnType<typeof readCalendarFeedToken> = null;
  try { parsed = readCalendarFeedToken(raw.replace(/\.ics$/i, "")); } catch { /* signing secret missing: treat as invalid */ }
  if (!parsed) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  if (!enabled) {
    return new NextResponse(renderPersonalFeed({ examDate: null, activeExam: null }, lang, false), { status: 200, headers: { ...ICS_HEADERS, ...NO_STORE } });
  }
  const { data, error } = await getServiceClient()
    .from("users")
    .select("exam_date, active_exam, is_banned, session_invalidated_at")
    .eq("id", parsed.userId)
    .maybeSingle();
  if (error) throw new Error(`calendar feed user read: ${error.message}`);
  if (!data || data.is_banned) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const revokedAt = data.session_invalidated_at ? Date.parse(data.session_invalidated_at as string) : 0;
  if (revokedAt && Math.floor(revokedAt / 1000) >= parsed.issuedAt) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const body = renderPersonalFeed(
    { examDate: typeof data.exam_date === "string" ? data.exam_date : null, activeExam: typeof data.active_exam === "string" ? data.active_exam : null },
    lang,
    true,
  );
  void logFeedFetch({ kind: "personal", feed: "personal", userId: parsed.userId, ua: req.headers.get("user-agent"), throttleKey: `personal:${parsed.userId}` });
  return new NextResponse(body, { status: 200, headers: { ...ICS_HEADERS, ...NO_STORE } });
}

export const GET = withDbUnavailable(handleGET);
