/**
 * /pricing server wrapper (a-pricing-v2). Reads the offer switches on the
 * server and hands them to the client page, which cannot read server env.
 * PRICING_V2_ENABLED unset: the client renders today's offer unchanged.
 * Env flags are bound to the deployment, so a flag flip still ships with a
 * redeploy. a-landing-fresh-referrer-1019: the HTML itself is regenerated
 * hourly (ISR), so the sitting calendar and its render instant age by at most
 * an hour (the first request after the window gets the old copy once while
 * the new one renders; the calendar's day counts are client-side anyway).
 */
import PricingClient, { type PricingOffer } from "./PricingClient";
import { pricingV2Enabled, reverseTrialEnabled } from "@/lib/pricing-v2/flag";
import { halfYearGuardLive, ticketMentorReady, v2Readiness } from "@/lib/pricing-v2/readiness";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";

export const revalidate = 3600;

export default function PricingPage() {
  const offer: PricingOffer = {
    v2: pricingV2Enabled(),
    reverseTrial: reverseTrialEnabled(),
    ready: v2Readiness(),
    // The number the ticket card states is the Cohort amount the grant uses.
    ticketMentorCredits: ticketMentorReady() ? readFreeCreditConfig().cohortIncludedCredits : null,
    // a-pricing-v2-fit: the totals count on the renewal guard only while it runs for real.
    halfYearGuard: halfYearGuardLive(),
  };
  // a-landing-418-fix: the render instant travels with the HTML so the calendar hydrates the same dates.
  return <PricingClient offer={offer} renderedAt={new Date().toISOString()} />;
}
