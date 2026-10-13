import { NextRequest, NextResponse } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { mentorLearnerRouteOpenFor, mentorRouteClosed } from "@/lib/mentor/route-gate";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { saveMentorReport } from "./handler";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!(await mentorLearnerRouteOpenFor({ userId: guard.userId, paidAccess: isPaidAccess(guard) }))) return mentorRouteClosed();
  const gate = checkRateLimit({ key: rateKey("mentor-report", guard.userId), limit: 5, windowMs: 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 4096) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_input" }, { status: 400 }); }
  try {
    const ok = await saveMentorReport(getServiceClient(), guard.userId, body);
    return NextResponse.json(ok ? { ok: true } : { error: "invalid_input" }, { status: ok ? 200 : 400, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "reserve_failed" }, { status: 503 });
  }
}
