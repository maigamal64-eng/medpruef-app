import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { calendarFeedEnabled, parseFeedLang } from "@/lib/exam-calendar/feed";
import { signCalendarFeedToken } from "@/lib/reminders/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORIGIN = "https://medpruf.com";

/**
 * Signed-in learner: returns the personal feed address (https and webcal).
 * Flag off: { enabled: false }, nothing is signed. The token is deterministic
 * per issue second, the address never carries an account id or an email.
 */
export async function GET(req: NextRequest) {
  if (!calendarFeedEnabled()) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!checkRateLimit({ key: rateKey("calendar-feed-url", guard.userId), limit: 10, windowMs: 600_000 }).allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "600" } });
  }
  let token: string;
  try { token = signCalendarFeedToken(guard.userId); } catch { return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } }); }
  const lang = parseFeedLang(req.nextUrl.searchParams.get("lang"));
  const path = `/api/calendar/u/${token}.ics${lang === "en" ? "?lang=en" : ""}`;
  return NextResponse.json({ enabled: true, https: `${ORIGIN}${path}`, webcal: `webcal://${ORIGIN.replace("https://", "")}${path}` }, { headers: { "Cache-Control": "no-store" } });
}
