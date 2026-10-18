/**
 * /pricing server wrapper (a-pricing-v2). Reads the offer switches on the
 * server and hands them to the client page, which cannot read server env.
 * PRICING_V2_ENABLED unset: the client renders today's offer unchanged.
 * Built at deploy (no request data), so a flag flip ships with a redeploy.
 */
import PricingClient, { type PricingOffer } from "./PricingClient";
import { pricingV2Enabled, reverseTrialEnabled } from "@/lib/pricing-v2/flag";
import { halfYearGuardLive, ticketMentorReady, v2Readiness } from "@/lib/pricing-v2/readiness";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";

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
