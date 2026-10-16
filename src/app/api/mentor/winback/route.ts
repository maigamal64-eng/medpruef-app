import { NextResponse, type NextRequest } from "next/server";
import { isPaidAccess, requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { readWinbackNote } from "@/lib/mentor/credits/winback";
import { mentorLearnerRouteOpenFor } from "@/lib/mentor/route-gate";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/mentor/winback (J11): the caller's win-back lot for the Home note.
 * {enabled:false} while REWARDS_WINBACK_ENABLED is off (no read). Otherwise
 * {enabled:true, note} where note is the newest live win-back lot granted in
 * the last 30 days ({lot_id, credits left, expires_at}) or null; null too when
 * the account has paid access again (the note says access ended) or the
 * mentor is closed to it (the note would point at a dead end).
 * Own lot only; no other learner's data.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  const fc = readFreeCreditConfig();
  const headers = { "cache-control": "no-store" };
  if (!fc.winbackEnabled) return NextResponse.json({ enabled: false }, { headers });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  // A learner who is paying again has no ended access to speak of; a closed mentor would be a dead end.
  const paid = isPaidAccess(guard);
  if (paid || !(await mentorLearnerRouteOpenFor({ userId: guard.userId, paidAccess: paid }))) {
    return NextResponse.json({ enabled: true, note: null }, { headers });
  }
  const note = await readWinbackNote(getServiceClient(), guard.userId, new Date());
  return NextResponse.json({ enabled: true, note }, { headers });
});
