import LandingClient from "./LandingClient";

/** Static HTML reserves the existing enabled ribbon without reading cookies. */
export default function LandingPage() {
  return <LandingClient reserveTrial={process.env.NOTES_TRIAL_ENABLED === "true"} />;
}
