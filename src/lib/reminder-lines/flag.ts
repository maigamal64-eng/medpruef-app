/**
 * Switches of the A3 reminder lines (a-growth-lines-1102). Each is OFF unless
 * its value is the literal "true"; server env, read at render (the answer
 * pages are built at deploy, so a flip ships with the redeploy, as every
 * Vercel env change does).
 *
 *   ANSWER_REMINDER_LINE_ENABLED   the reminder block on SIP and Rez/GM
 *                                  answer pages, below the official links
 *   LERNPLAN_REMINDER_LINE_ENABLED the reminder line on /lernplan once the
 *                                  plan is built, above the save CTAs
 *
 * Pure: reads only the env object it is given, so tests pass their own.
 */
type Env = Record<string, string | undefined>;

export function answerReminderLineEnabled(env: Env = process.env): boolean {
  return env.ANSWER_REMINDER_LINE_ENABLED === "true";
}

export function lernplanReminderLineEnabled(env: Env = process.env): boolean {
  return env.LERNPLAN_REMINDER_LINE_ENABLED === "true";
}
