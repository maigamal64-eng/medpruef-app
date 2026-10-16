/**
 * Switches of the day-1 sitting ask (a-day1-sitting-ask).
 *
 *   DAY1_SITTING_ASK_ENABLED  server, default OFF: only the literal "true"
 *                             lets /api/cron/day1-sitting-ask read anything.
 *   DAY1_SITTING_ASK_DRY_RUN  server, default ON: anything but the literal
 *                             "false" keeps the run a count-only dry run
 *                             (no claim, no mail, no event, no write).
 *
 * Pure: reads only the env object it is given.
 */
type Env = Record<string, string | undefined>;

export function day1AskEnabled(env: Env = process.env): boolean {
  return env.DAY1_SITTING_ASK_ENABLED === "true";
}

export function day1AskDryRun(env: Env = process.env): boolean {
  return env.DAY1_SITTING_ASK_DRY_RUN !== "false";
}
