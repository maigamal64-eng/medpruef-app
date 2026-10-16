import { NextResponse } from "next/server";
import { TIERS } from "@/lib/whop";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { reverseTrialEnabled } from "@/lib/pricing-v2/flag";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";

const TRIAL_DAYS = 7;

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/trial/status — PUBLIC (no auth) trial availability probe.
 *
 * The landing page is a client component and cannot read the server-side
 * NOTES_TRIAL_ENABLED flag directly, and anonymous top-of-funnel visitors have
 * no session. This tiny public endpoint lets the landing <TrialRibbon> track
 * the flag: flip NOTES_TRIAL_ENABLED off and the announcement disappears — no
 * stale "free week" promo advertising a disabled trial. Carries no user data.
 */
async function handleGET() {
  // a-pricing-v2: the card trial is dormant while the reverse trial is on;
  // `reverse_trial` lets public surfaces state the no-card terms instead.
  const reverse = reverseTrialEnabled();
  const enabled =
    (process.env.NOTES_TRIAL_ENABLED ?? "false").toLowerCase() === "true" && !reverse;
  return NextResponse.json({
    enabled,
    ...(reverse ? { reverse_trial: { enabled: true, days: REVERSE_TRIAL_DAYS } } : {}),
    trial_days: TRIAL_DAYS,
    // Plan data, never a typed amount (UX-PUB-44).
    price_after_cents: TIERS.notes_pro_trial?.priceCents ?? TIERS.first_month_19.priceCents,
    currency: "EUR",
    // First charge if a trial started now, so every surface can name the date.
    charge_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
  });
}

export const GET = withDbUnavailable(handleGET);
