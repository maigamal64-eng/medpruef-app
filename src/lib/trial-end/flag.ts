/**
 * TRIAL_END_CARD_ENABLED (a-trial-end-decision, default OFF): the "your plan
 * to your sitting" card in the reverse trial's last 24 hours, once on Home
 * after it ends and inside the paywall. Only the literal "true" turns it on;
 * runtime env, no redeploy. Off: /api/trial-end answers {enabled:false}
 * without a session or database read and /api/auth/me reports false, so no
 * client asks anything. Pure.
 */
type Env = Record<string, string | undefined>;

export const TRIAL_END_CARD_ENV = "TRIAL_END_CARD_ENABLED";

export function trialEndCardEnabled(env: Env = process.env): boolean {
  return env[TRIAL_END_CARD_ENV] === "true";
}
