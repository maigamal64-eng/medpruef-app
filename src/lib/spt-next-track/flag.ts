/**
 * SPT_NEXT_TRACK_ENABLED (a-growth-lines-1102, A2, default OFF): the Home
 * pointer from the Stichprobentest to Rezeptierkunde and Gerichtsmedizin for
 * a learner whose Stichprobentest sitting has passed. Only the literal "true"
 * turns it on; runtime env, reported to the client by /api/auth/me so no
 * client asks anything while it is off. Pure.
 */
type Env = Record<string, string | undefined>;

export function sptNextTrackEnabled(env: Env = process.env): boolean {
  return env.SPT_NEXT_TRACK_ENABLED === "true";
}
