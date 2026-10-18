import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  FEEDBACK_ASK_SHOWN_EVENT,
  QUIZ_SOURCE,
  ROUND_END_SURFACE,
  cooldownStart,
  decideFeedbackAsk,
  feedbackAskEnabled,
  type FeedbackAskReason,
} from "@/lib/feedback-ask/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "cache-control": "no-store" };

type Db = ReturnType<typeof getServiceClient>;

/** Newest feedback_ask_shown row in the cooldown window, any surface or source (mail asks block too). */
async function lastShownAt(sb: Db, userId: string, now: Date): Promise<string | null> {
  const { data, error } = await sb
    .from("user_events")
    .select("created_at")
    .eq("user_id", userId)
    .eq("event_type", FEEDBACK_ASK_SHOWN_EVENT)
    .gte("created_at", cooldownStart(now).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { created_at?: string | null } | undefined;
  return row?.created_at ?? null;
}

/** exam_date and active_exam come with the guard lookup; one users read only when a caller built the guard by hand. */
async function learnerOf(sb: Db, guard: { userId: string; profile?: { examDate: string | null; activeExam: string | null } }) {
  if (guard.profile) return { examDate: guard.profile.examDate, activeExam: guard.profile.activeExam };
  const { data, error } = await sb.from("users").select("exam_date, active_exam").eq("id", guard.userId).maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as { exam_date?: string | null; active_exam?: string | null };
  return { examDate: row.exam_date ?? null, activeExam: row.active_exam ?? null };
}

function limited(userId: string, kind: "read" | "write"): NextResponse | null {
  const gate = checkRateLimit({ key: `feedback-ask-${kind}:${userId}`, limit: kind === "read" ? 30 : 10, windowMs: 60 * 60_000 });
  if (gate.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests", retryAfter: gate.retryAfterSec },
    { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
  );
}

/** The decision for this learner now: sitting week first (no read), then the newest ask in 14 days. */
async function decide(sb: Db, guard: Parameters<typeof learnerOf>[1], now: Date): Promise<FeedbackAskReason> {
  const learner = await learnerOf(sb, guard);
  const early = decideFeedbackAsk({ lastShownAt: null, learner, now });
  if (early !== "ok") return early;
  return decideFeedbackAsk({ lastShownAt: await lastShownAt(sb, guard.userId, now), learner, now });
}

/**
 * GET /api/feedback/ask (a-feedback-at-pause): may the quiz round-end card
 * show the one optional feedback question now? Writes nothing. While
 * FEEDBACK_ASK_ENABLED is off: {enabled:false} with no read. On: {show:false}
 * in the learner's own sitting week or within 14 days of any earlier ask (in
 * app or by mail, any feedback_ask_shown row), else {show:true}. The card
 * asks this before it competes for the announcement slot, so a learner who
 * cannot be asked never takes the session's inline slot from another card.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  if (!feedbackAskEnabled()) return NextResponse.json({ enabled: false, show: false }, { headers: noStore });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const slow = limited(guard.userId, "read");
  if (slow) return slow;
  const reason = await decide(getServiceClient(), guard, new Date());
  return NextResponse.json({ enabled: true, show: reason === "ok", ...(reason === "ok" ? {} : { reason }) }, { headers: noStore });
});

/**
 * POST /api/feedback/ask: the card is about to render. Re-checks the same
 * rules and stores one user_events row feedback_ask_shown
 * {surface:"round_end", source:"quiz"}; answers {show:true} only then. The
 * answer itself goes through POST /api/feedback (context.source
 * "round_end_ask").
 */
export const POST = withDbUnavailable(async (req: NextRequest) => {
  if (!feedbackAskEnabled()) return NextResponse.json({ enabled: false, show: false }, { headers: noStore });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const slow = limited(guard.userId, "write");
  if (slow) return slow;
  const sb = getServiceClient();
  const reason = await decide(sb, guard, new Date());
  if (reason !== "ok") return NextResponse.json({ enabled: true, show: false, reason }, { headers: noStore });
  const { error } = await sb.from("user_events").insert({
    user_id: guard.userId,
    event_type: FEEDBACK_ASK_SHOWN_EVENT,
    event_data: { surface: ROUND_END_SURFACE, source: QUIZ_SOURCE },
  });
  if (error) throw error;
  return NextResponse.json({ enabled: true, show: true }, { headers: noStore });
});
