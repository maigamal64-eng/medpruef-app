import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { EXAM_SOURCE_IDS, DEFAULT_EXAM_SOURCE } from "@/lib/topics";
import { WEEKS_SHOWN, buildWeeklyProgress, type AnswerRow } from "@/lib/master-learning/weekly-progress";

export const dynamic = "force-dynamic";

const PAGE = 1000;
/** Hard stop so one heavy account cannot turn this into a full scan. */
const MAX_ROWS = 20000;

/**
 * GET /api/user/weekly-progress (a25, LX-09-R): answers and accuracy per
 * Vienna ISO week for the last 12 weeks, active exam only, the signed-in
 * learner's own rows only (requireUser; no id is read from the request).
 * Bounded by date and paged past the 1000-row PostgREST cap; `truncated`
 * says when MAX_ROWS stopped the read so the page never presents a partial
 * week as complete.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const sb = getServiceClient();
  try {
    const { data: user, error: userErr } = await sb.from("users").select("active_exam").eq("id", guard.userId).maybeSingle();
    if (userErr) throw userErr;
    const activeExam =
      typeof user?.active_exam === "string" && (EXAM_SOURCE_IDS as string[]).includes(user.active_exam)
        ? user.active_exam
        : DEFAULT_EXAM_SOURCE;

    const now = new Date();
    // One extra week of margin: the pure grouper drops anything before the first Monday.
    const since = new Date(now.getTime() - (WEEKS_SHOWN + 1) * 7 * 86_400_000).toISOString();
    const rows: AnswerRow[] = [];
    let truncated = false;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("answer_history")
        .select("created_at, is_correct, questions!inner(exam_type)")
        .eq("user_id", guard.userId)
        .eq("questions.exam_type" as string, activeExam)
        .gte("created_at", since)
        // Newest first, so a MAX_ROWS stop drops the oldest weeks, not the current one.
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data || []) rows.push({ createdAt: String(r.created_at), isCorrect: r.is_correct === true });
      if (!data || data.length < PAGE) break;
      if (rows.length >= MAX_ROWS) { truncated = true; break; }
    }

    return NextResponse.json({
      activeExam,
      weeks: buildWeeklyProgress(rows, { now, timeZone: "Europe/Vienna" }),
      truncated,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "/api/user/weekly-progress" } });
    return NextResponse.json({ error: "Failed to load weekly progress" }, { status: 500 });
  }
}
