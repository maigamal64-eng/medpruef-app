import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/trial/status — PUBLIC (no auth) trial availability probe.
 *
 * The landing page is a client component and cannot read the server-side
 * NOTES_TRIAL_ENABLED flag directly, and anonymous top-of-funnel visitors have
 * no session. This tiny public endpoint lets the landing <TrialRibbon> track
 * the flag: flip NOTES_TRIAL_ENABLED off and the announcement disappears — no
 * stale "free week" promo advertising a disabled trial. Carries no user data.
 */
export async function GET() {
  const enabled =
    (process.env.NOTES_TRIAL_ENABLED ?? "false").toLowerCase() === "true";
  return NextResponse.json({
    enabled,
    trial_days: 7,
    price_after_cents: 1900,
    currency: "EUR",
  });
}
