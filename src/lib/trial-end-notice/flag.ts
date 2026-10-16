/**
 * Switches of the reverse-trial end notice (a-reverse-trial-end-mail).
 *
 *   TRIAL_END_NOTICE_ENABLED           server, default OFF: only the literal
 *                                      "true" lets the daily trial-reminder
 *                                      sweep run this step. Off, nothing is read.
 *   TRIAL_END_NOTICE_DRY_RUN           server, default ON: only the literal
 *                                      "false" sends. A dry run decides and
 *                                      counts but writes no claim, no event and
 *                                      sends nothing, so it never uses up a
 *                                      learner's one notice.
 *   TRIAL_END_NOTICE_TELEGRAM_ENABLED  server, default OFF: separate release
 *                                      for the bot message to Telegram-linked
 *                                      accounts without a confirmed address
 *                                      (CEO decision class-approvals).
 *
 * Pure: reads only the env object it is given.
 */
type Env = Record<string, string | undefined>;

export function trialEndNoticeEnabled(env: Env = process.env): boolean {
  return env.TRIAL_END_NOTICE_ENABLED === "true";
}
export function trialEndNoticeDryRun(env: Env = process.env): boolean {
  return env.TRIAL_END_NOTICE_DRY_RUN !== "false";
}
export function trialEndNoticeTelegramEnabled(env: Env = process.env): boolean {
  return env.TRIAL_END_NOTICE_TELEGRAM_ENABLED === "true";
}
