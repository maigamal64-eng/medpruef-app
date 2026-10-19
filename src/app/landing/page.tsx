import LandingClient from "./LandingClient";
import { reverseTrialCopyEnabled } from "@/lib/pricing-v2/flag";
import { publicPlanEnabled } from "@/lib/study-plan-public";

/**
 * a-landing-fresh-referrer-1019: the deadline calendar ages with the clock, so
 * the prerendered HTML is regenerated at most hourly (19 Oct the CDN served a
 * 2.2-day-old page). Literal number: Next reads segment config statically.
 */
export const revalidate = 3600;

/** Static HTML reserves the existing enabled ribbon without reading cookies. */
export default function LandingPage() {
  // a-pricing-v2: the card trial is dormant while the reverse trial is on.
  // a-landing-418-fix: the render instant travels with the HTML so the client hydrates the same dates.
  return (
    <LandingClient
      reserveTrial={process.env.NOTES_TRIAL_ENABLED === "true" && !reverseTrialCopyEnabled()}
      renderedAt={new Date().toISOString()}
      // a-home-lernplan-link-1018: the /lernplan entry follows the page flag (STUDY_PLAN_PUBLIC_ENABLED).
      lernplanLink={publicPlanEnabled()}
    />
  );
}
