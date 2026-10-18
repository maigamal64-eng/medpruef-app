import LandingClient from "./LandingClient";
import { reverseTrialCopyEnabled } from "@/lib/pricing-v2/flag";

/** Static HTML reserves the existing enabled ribbon without reading cookies. */
export default function LandingPage() {
  // a-pricing-v2: the card trial is dormant while the reverse trial is on.
  // a-landing-418-fix: the render instant travels with the HTML so the client hydrates the same dates.
  return (
    <LandingClient
      reserveTrial={process.env.NOTES_TRIAL_ENABLED === "true" && !reverseTrialCopyEnabled()}
      renderedAt={new Date().toISOString()}
    />
  );
}
