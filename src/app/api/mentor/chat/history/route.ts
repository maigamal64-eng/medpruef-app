import { NextRequest, NextResponse } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { mentorLearnerRouteOpenFor, mentorRouteClosed } from "@/lib/mentor/route-gate";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { loadMentorThread } from "@/lib/mentor/thread";
import { eraseMentorHistory } from "./erase";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!(await mentorLearnerRouteOpenFor({ userId: auth.userId, paidAccess: isPaidAccess(auth) }))) return mentorRouteClosed();
  const id = req.nextUrl.searchParams.get("conversation_id") ?? undefined;
  if (id && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const gate = checkRateLimit({ key: rateKey("mentor-history", auth.userId), limit: 30, windowMs: 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "rate_limited", limit: "minute" }, { status: 429 });
  try {
    return NextResponse.json(await loadMentorThread(getServiceClient(), auth.userId, id), { headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: "reserve_failed" }, { status: 503 }); }
}

/** Available to owners even while rollout is paused. Settings must reuse it. */
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const gate = checkRateLimit({ key: rateKey("mentor-erase", auth.userId), limit: 5, windowMs: 60_000 });
  const headers = { "cache-control": "no-store" };
  if (!gate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers });
  try {
    const result = await eraseMentorHistory(getServiceClient(), auth.userId);
    return NextResponse.json(result.ok ? result : { error: "invalid_input", reason: result.reason }, { status: result.ok ? 200 : result.reason === "in_progress" ? 409 : 400, headers });
  } catch { return NextResponse.json({ error: "reserve_failed" }, { status: 503, headers }); }
}
