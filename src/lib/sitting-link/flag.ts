/**
 * Switches of the one-tap sitting link (a-sitting-one-tap).
 *
 *   SITTING_LINK_ENABLED  server, default OFF: only the literal "true" opens
 *                         /api/sitting-link. Off, the route answers a neutral
 *                         404 page and reads nothing.
 *   DATE_WATCH_FREEZE     server, default OFF: the date-watch freeze. While it
 *                         is the literal "true" the page shows no date, no
 *                         choice and no offer, only the official pages, and a
 *                         POST writes nothing. One shared name, so other dated
 *                         surfaces can follow the same switch.
 *
 * Pure: reads only the env object it is given, so tests pass their own.
 */
type Env = Record<string, string | undefined>;

export function sittingLinkEnabled(env: Env = process.env): boolean {
  return env.SITTING_LINK_ENABLED === "true";
}

export function datesFrozen(env: Env = process.env): boolean {
  return env.DATE_WATCH_FREEZE === "true";
}
