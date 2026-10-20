/**
 * Switches of the post-expiry mail (a-renewal-pack-1019).
 *
 *   ACCESS_ENDED_EMAILS_ENABLED   server, default OFF: only the literal "true"
 *                                 lets the daily trial-reminder sweep run this
 *                                 step. Off, nothing is read.
 *   ACCESS_ENDED_DRY_RUN          server, default ON: only the literal "false"
 *                                 sends. A dry run decides and counts but
 *                                 writes no claim, no event and sends nothing.
 *
 * Pure: reads only the env object it is given.
 */
type Env = Record<string, string | undefined>;

export function accessEndedEmailsEnabled(env: Env = process.env): boolean {
  return env.ACCESS_ENDED_EMAILS_ENABLED === "true";
}
export function accessEndedDryRun(env: Env = process.env): boolean {
  return env.ACCESS_ENDED_DRY_RUN !== "false";
}
