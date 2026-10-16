/**
 * HOME_CRAM_CARD_ENABLED (a-cram-card, default OFF): the Home cram card for
 * the learner's own sitting (SIP4a/SIP5a, or Rezeptierkunde/Gerichtsmedizin
 * exam week). Only the literal "true" turns it on; runtime env, no redeploy.
 * Off: /api/home/cram-card answers {enabled:false} without a session or
 * database read, /api/auth/me reports false so no client asks anything, and
 * the older HomeJourney M4 card keeps its own rule. Pure.
 */
type Env = Record<string, string | undefined>;

export const HOME_CRAM_CARD_ENV = "HOME_CRAM_CARD_ENABLED";

export function homeCramCardEnabled(env: Env = process.env): boolean {
  return env[HOME_CRAM_CARD_ENV] === "true";
}
