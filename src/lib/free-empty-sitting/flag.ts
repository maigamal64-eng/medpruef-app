/**
 * Switch of the free empty-state sitting line (a-growth-lines-1102, angle A1).
 *
 *   FREE_EMPTY_SITTING_ENABLED  server, default OFF: only the literal "true"
 *                               lets GET /api/free-empty/sitting-line answer
 *                               anything but { state: "none" }. Off, the empty
 *                               state renders exactly as before.
 *
 * Pure: reads only the env object it is given, so tests pass their own.
 */
type Env = Record<string, string | undefined>;

export function freeEmptySittingEnabled(env: Env = process.env): boolean {
  return env.FREE_EMPTY_SITTING_ENABLED === "true";
}
