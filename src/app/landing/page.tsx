import LandingClient from "./LandingClient";
import { activeCardTrialTier } from "@/lib/card-trial";
import { v2Readiness } from "@/lib/pricing-v2/readiness";
import { publicPlanEnabled } from "@/lib/study-plan-public";

/**
 * a-landing-fresh-referrer-1019: the deadline calendar ages with the clock, so
 * the prerendered HTML is regenerated at most hourly (19 Oct the CDN served a
 * 2.2-day-old page). ISR serves the old copy once to the first request after
 * the hour while it regenerates; the "noch N Tage" text is computed from the
 * client clock after mount regardless. Literal number: Next reads segment
 * config statically.
 */
export const revalidate = 3600;

/** Static HTML reserves the existing enabled ribbon without reading cookies. */
export default function LandingPage() {
  // a-pricing-v2: the card trial is dormant while the reverse trial is on.
  // a-card-trial-build-1024: the ribbon space follows the card trial a checkout would start (3-day or 7-day).
  // a-landing-418-fix: the render instant travels with the HTML so the client hydrates the same dates.
  return (
    <LandingClient
      reserveTrial={activeCardTrialTier() !== null}
      renderedAt={new Date().toISOString()}
      // a-home-lernplan-link-1018: the /lernplan entry follows the page flag (STUDY_PLAN_PUBLIC_ENABLED).
      lernplanLink={publicPlanEnabled()}
      // a-v2-readiness-surfaces-1020: only plans checkout can sell get a preview card (server env, hourly ISR).
      v2Ready={v2Readiness()}
    />
  );
}
