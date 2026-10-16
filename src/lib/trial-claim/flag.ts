/**
 * Switch of the one-time 3-day claim for existing accounts
 * (a-reverse-trial-claim, CEO decision release-claim, 15 Oct 2026).
 *
 *   TRIAL_CLAIM_ENABLED   server, default OFF: only the literal "true" opens
 *                         the claim (signed mail link and Home card).
 *
 * The claim also needs the reverse trial itself to be on
 * (reverseTrialEnabled: NEXT_PUBLIC_REVERSE_TRIAL at build, plus
 * REVERSE_TRIAL_ENABLED and REVERSE_TRIAL_SINCE at runtime), so the terms,
 * FAQ and pricing copy that describe the 3-day trial are live whenever a
 * claim can happen, and switching the reverse trial off stops claims at once.
 *
 * Pure: reads only the env object it is given, so tests pass their own.
 */
import { reverseTrialEnabled } from "@/lib/pricing-v2/flag";

type Env = Record<string, string | undefined>;

export function trialClaimEnabled(env?: Env): boolean {
  const source = env ?? process.env;
  return source.TRIAL_CLAIM_ENABLED === "true" && reverseTrialEnabled(env);
}
