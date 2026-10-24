import { NextResponse } from "next/server";
import { TIERS } from "@/lib/whop";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { reverseTrialEnabled } from "@/lib/pricing-v2/flag";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";
import { activeCardTrialTier, cardTrialDays } from "@/lib/card-trial";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/trial/status — PUBLIC (no auth) trial availability probe.
 *
 * The landing page is a client component and cannot read the server-side
 * trial switches directly, and anonymous top-of-funnel visitors have no
 * session. This tiny public endpoint lets the landing <TrialRibbon>, the
 * signup screen and the pricing tile track them: switch the card trial off
 * and the announcement disappears, no stale promo advertising a disabled
 * trial. Carries no user data.
 *
 * a-card-trial-build-1024: `enabled` names the card trial a checkout would
 * start now (activeCardTrialTier: the 3-day trial at 24 EUR every 30 days,
 * else the dormant 7-day trial), with its days and renewal price from the
 * tier; `tier` says which.
 */
async function handleGET() {
  // a-pricing-v2: the card trial is dormant while the reverse trial is on;
  // `reverse_trial` lets public surfaces state the no-card terms instead.
  const reverse = reverseTrialEnabled();
  const tier = activeCardTrialTier();
  const shown = tier ?? "notes_pro_trial";
  const days = cardTrialDays(shown);
  return NextResponse.json({
    enabled: tier !== null,
    tier,
    ...(reverse ? { reverse_trial: { enabled: true, days: REVERSE_TRIAL_DAYS } } : {}),
    trial_days: days,
    // Plan data, never a typed amount (UX-PUB-44).
    price_after_cents: TIERS[shown]?.priceCents ?? TIERS.first_month_19.priceCents,
    currency: "EUR",
    // First charge if a trial started now, so every surface can name the date.
    charge_at: new Date(Date.now() + days * 86_400_000).toISOString(),
  });
}

export const GET = withDbUnavailable(handleGET);
