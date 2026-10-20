import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { captureServerError } from "@/lib/sentry-capture";
import { LONG_DB_TIMEOUT_MS } from "@/lib/db-unavailable";
import { forgetInFlight } from "@/lib/inflight";
import {
  RESET_HTTP,
  TOPIC_RESET_DAILY_LIMIT,
  TOPIC_RESET_MAX_ROWS,
  isResetStatus,
  missingSchema,
  parseTopicResetBody,
  topicResetEnabled,
} from "@/lib/topic-reset";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * a-topic-reset-selfserve-1019. GET: is the reset offered ({enabled}, no
 * session or database read). POST {exam_type, topic}: the signed-in learner
 * resets the progress of that one subject. One SQL function, one transaction
 * (topic_progress_reset): archives every row of answer_history,
 * user_question_progress, user_topic_strength and flashcard_reviews for the
 * subject into progress_resets, deletes them with count checks, keeps
 * bookmarks, writes the topic_progress_reset event. XP, streak, plan,
 * subscriptions, simulations and other subjects are never touched.
 * Limit: TOPIC_RESET_DAILY_LIMIT per learner in 24 hours (SQL, under a lock),
 * plus a per-instance burst guard. Flag TOPIC_RESET_ENABLED (literal 'true').
 */
async function handleGET() {
  return NextResponse.json({ enabled: topicResetEnabled() }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(req: NextRequest) {
  if (!topicResetEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  const burst = checkRateLimit({ key: `topic-reset:${guard.userId}`, limit: 5, windowMs: 60_000 });
  if (!burst.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "rate_limited", retryAfter: burst.retryAfterSec },
      { status: 429, headers: rateLimitHeaders(burst, { limit: 5 }) },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body", code: "invalid" }, { status: 400 });
  }
  const input = parseTopicResetBody(body);
  if (!input) return NextResponse.json({ error: "Valid exam_type and topic are required", code: "invalid" }, { status: 400 });

  // A large subject is archived and deleted in one transaction: the long
  // deadline, so a slow commit is not reported as a failure it was not.
  const sb = getServiceClient({ timeoutMs: LONG_DB_TIMEOUT_MS });
  const { data, error } = await sb.rpc("topic_progress_reset", {
    p_user: guard.userId,
    p_exam_type: input.examType,
    p_topic: input.topic,
    p_daily_limit: TOPIC_RESET_DAILY_LIMIT,
    p_max_rows: TOPIC_RESET_MAX_ROWS,
  });
  if (error) {
    if (missingSchema(error)) {
      return NextResponse.json({ error: "Reset is not available yet", code: "unavailable" }, { status: 503, headers: { "Retry-After": "60" } });
    }
    throw error;
  }
  const result = (data ?? {}) as { status?: unknown; reset_id?: unknown; counts?: unknown };
  if (!isResetStatus(result.status)) {
    captureServerError(new Error("topic_progress_reset returned an unknown status"), { route: "/api/user/topic-progress/reset" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (result.status === "reset") {
    // A shared round of the topic aggregates in flight on this instance would
    // hand back the pre-reset numbers.
    forgetInFlight(`topic-progress:${guard.userId}:${input.examType}:`);
  }
  return NextResponse.json(
    {
      ok: result.status === "reset" || result.status === "empty",
      code: result.status,
      ...(result.status === "reset" ? { counts: result.counts ?? {} } : {}),
      ...(result.status === "rate_limited" ? { limit: TOPIC_RESET_DAILY_LIMIT } : {}),
    },
    { status: RESET_HTTP[result.status] },
  );
}

export const GET = handleGET;
export const POST = withDbUnavailable(handlePOST);
