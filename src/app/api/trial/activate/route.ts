import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /api/trial/activate — RETIRED 2026-07-09.
 *
 * This was briefly the no-card trial (2026-07-04): one tap granted 7 days of
 * full Pro with no card. That defeated the point of the trial, because Pro
 * consumes real AI credits, so the card on file is the seriousness gate AND
 * the auto-conversion hook. Per [name] (2026-07-09) the trial is the Whop
 * card-on-file flow again: `/api/whop/trial` (card, €0 now, then €19/month
 * unless cancelled in-trial), granted on return by `/api/whop/trial/verify`.
 *
 * This route no longer grants anything. It is kept as an explicit, guarded
 * dead end (rather than deleted) so any stale client that still calls it fails
 * closed and is pointed at the real trial, instead of 404-ing ambiguously.
 */

const MOVED = {
  error: "The free trial now requires a card on file. Use the Whop trial.",
  code: "TRIAL_MOVED",
  use: "/api/whop/trial",
} as const;

export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  // Report ineligible so any legacy UI reading this hides its no-card banner.
  return NextResponse.json({
    eligible: false,
    trial_enabled: false,
    retired: true,
    ...MOVED,
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  // Never grant. The card-on-file trial is the only path.
  return NextResponse.json(MOVED, { status: 410 });
}
