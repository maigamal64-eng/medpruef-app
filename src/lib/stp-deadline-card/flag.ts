/**
 * STP_DEADLINE_CARD_ENABLED (a-c1-stp-card-1119, angle C1, default OFF): the
 * Home card with the two published Stichprobentest deadlines. Only the
 * literal "true" turns it on; runtime env, reported to the client by
 * /api/auth/me so no client asks anything while it is off. Pure.
 */
type Env = Record<string, string | undefined>;

export function stpDeadlineCardEnabled(env: Env = process.env): boolean {
  return env.STP_DEADLINE_CARD_ENABLED === "true";
}
