/**
 * Build gate of the 3-day card trial (a-card-trial-build-1024), read by
 * next.config.ts at build time. Pure and import-free so next.config.ts can
 * load it and vitest can cover it. Returns the reason the build must fail, or
 * null.
 *
 *   - CARD_TRIAL_ENABLED and REVERSE_TRIAL_ENABLED both on: the site would
 *     promise two different trials (card and no card), so the build fails.
 *   - CARD_TRIAL_ENABLED and NOTES_TRIAL_ENABLED both on: two card trials.
 *   - CARD_TRIAL_ENABLED on without WHOP_PLAN_FLEX_TRIAL: the copy would
 *     promise a trial no checkout can start.
 */
export function cardTrialBuildGateError(env: Record<string, string | undefined>): string | null {
  if (env.CARD_TRIAL_ENABLED !== "true") return null;
  if (env.REVERSE_TRIAL_ENABLED === "true") {
    return "card trial gate: CARD_TRIAL_ENABLED and REVERSE_TRIAL_ENABLED are both 'true'; set REVERSE_TRIAL_ENABLED=false in the same deploy";
  }
  if ((env.NOTES_TRIAL_ENABLED ?? "").toLowerCase() === "true") {
    return "card trial gate: CARD_TRIAL_ENABLED and NOTES_TRIAL_ENABLED are both 'true'; the 7-day trial stays off";
  }
  if (!env.WHOP_PLAN_FLEX_TRIAL?.trim()) {
    return "card trial gate: CARD_TRIAL_ENABLED is 'true' but WHOP_PLAN_FLEX_TRIAL is not set";
  }
  return null;
}

/** NEXT_PUBLIC_CARD_TRIAL: the build copy of the switch ("true" or ""). */
export function cardTrialBuildMirror(env: Record<string, string | undefined>): "true" | "" {
  return env.CARD_TRIAL_ENABLED === "true" && cardTrialBuildGateError(env) === null ? "true" : "";
}
