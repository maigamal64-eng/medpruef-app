/**
 * a-email-confirm-trial: the email confirmation step for email registrations.
 *
 * EMAIL_CONFIRM_ENABLED (server, default off; only the literal "true").
 * The step also needs REMINDER_LINK_SIGNING_SECRET (at least 32 bytes), the
 * one secret for learner mail links: without it no link can be signed or
 * accepted, so the step stays off (no mail, no Home line, the page answers
 * 404) even with the flag on. Off = today's behaviour exactly.
 */
type Env = Record<string, string | undefined>;

export function emailConfirmFlag(env: Env = process.env): boolean {
  return env.EMAIL_CONFIRM_ENABLED === "true";
}

export function emailConfirmLinksConfigured(env: Env = process.env): boolean {
  const key = env.REMINDER_LINK_SIGNING_SECRET;
  return !!key && Buffer.byteLength(key) >= 32;
}

let warned = false;
/** Flag on and links can be signed. Warns once per instance when the flag is on without the secret. */
export function emailConfirmEnabled(env: Env = process.env): boolean {
  if (!emailConfirmFlag(env)) return false;
  if (emailConfirmLinksConfigured(env)) return true;
  if (!warned) {
    warned = true;
    console.warn("[email-confirm] EMAIL_CONFIRM_ENABLED is on but REMINDER_LINK_SIGNING_SECRET is missing; the step stays off");
  }
  return false;
}

/** Accounts at most this old see the Home line and may ask for a link (the reverse trial's age window). */
export const EMAIL_CONFIRM_WINDOW_DAYS = 7;
/** Link lifetime: the age window, so a link never outlives the account's chance to start the trial. */
export const EMAIL_CONFIRM_LINK_DAYS = 7;
