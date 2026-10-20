/**
 * Switches of the pre-charge renewal notice (a-renewal-pack-1019).
 *
 *   RENEWAL_NOTICE_ENABLED   server, default OFF: only the literal "true" lets
 *                            the daily trial-reminder sweep run this step.
 *                            Off, nothing is read and no Whop call is made.
 *   RENEWAL_NOTICE_DRY_RUN   server, default ON: only the literal "false"
 *                            sends. A dry run reads Whop, decides and counts,
 *                            but writes no claim, no event and sends nothing.
 *
 * Pure: reads only the env object it is given.
 */
type Env = Record<string, string | undefined>;

export function renewalNoticeEnabled(env: Env = process.env): boolean {
  return env.RENEWAL_NOTICE_ENABLED === "true";
}
export function renewalNoticeDryRun(env: Env = process.env): boolean {
  return env.RENEWAL_NOTICE_DRY_RUN !== "false";
}
