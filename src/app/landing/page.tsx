import LandingClient from "./LandingClient";
import { reverseTrialCopyEnabled } from "@/lib/pricing-v2/flag";

/** Static HTML reserves the existing enabled ribbon without reading cookies. */
export default function LandingPage() {
  // a-pricing-v2: the card trial is dormant while the reverse trial is on.
  return <LandingClient reserveTrial={process.env.NOTES_TRIAL_ENABLED === "true" && !reverseTrialCopyEnabled()} />;
}
