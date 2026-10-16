/**
 * Switches of the v2 offer (a-pricing-v2, track-A CEO decision 15 Oct 2026
 * under [name]'s delegation). Every one is OFF unless its value is the literal
 * string "true"; unset means today's offer, byte for byte.
 *
 *   PRICING_V2_ENABLED               the v2 offer on /pricing, checkout, the
 *                                    root JSON-LD, llms.txt and landing tiles
 *                                    (server; pages built at deploy, so flip
 *                                    it with a redeploy)
 *   REVERSE_TRIAL_ENABLED            3-day no-card full-access trial for new,
 *                                    verified accounts (needs
 *                                    REVERSE_TRIAL_SINCE); the card trial
 *                                    stays in the code but is dormant
 *   TICKET_RENEWAL_ENABLED           the Guarantee Ticket renewal-on-proof
 *                                    form, its admin queue and its crons
 *   TICKET_REMINDER_EMAILS_ENABLED   the "ticket ends in 30 days" email
 *   HALF_YEAR_REMINDER_EMAILS_ENABLED  the 7-day pre-renewal email for the
 *                                    6-month plan
 *   HALF_YEAR_AUTO_STOP_ENABLED      cancel the 6-month plan at Whop (at
 *                                    period end) once the exam date passed;
 *                                    an outbound provider write, so also
 *                                    HALF_YEAR_AUTO_STOP_DRY_RUN must be
 *                                    the literal "false" to actually call Whop
 *
 * Pure: reads only the env object it is given, so tests pass their own.
 */
type Env = Record<string, string | undefined>;

const on = (env: Env, key: string) => env[key] === "true";

/**
 * PRICING_V2_ENABLED, as the build saw it. next.config.ts copies it into
 * NEXT_PUBLIC_PRICING_V2 at build time, so server routes, server pages and
 * client pages (terms, FAQ, landing, pricing) all read the same value and a
 * flip ships with a redeploy. Tests pass their own env object.
 */
export function pricingV2Enabled(env?: Env): boolean {
  if (env) return on(env, "PRICING_V2_ENABLED");
  return process.env.NEXT_PUBLIC_PRICING_V2 === "true";
}

/**
 * The reverse trial runs only when the build copy (NEXT_PUBLIC_REVERSE_TRIAL,
 * which the terms, FAQ, landing and pricing copy read) AND the runtime env
 * (REVERSE_TRIAL_ENABLED plus REVERSE_TRIAL_SINCE) are on: switching it on
 * needs a redeploy so copy and grants agree, switching the runtime env off
 * stops new trials at once. Tests pass their own env object.
 */
export function reverseTrialEnabled(env?: Env): boolean {
  if (env) return on(env, "REVERSE_TRIAL_ENABLED") && reverseTrialSince(env) !== null;
  return reverseTrialCopyEnabled() && process.env.REVERSE_TRIAL_ENABLED === "true" && reverseTrialSince() !== null;
}

/** Copy only: the build copy of the reverse-trial switch (next.config.ts). */
export function reverseTrialCopyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REVERSE_TRIAL === "true";
}

/**
 * Only accounts created at or after this instant can get the reverse trial,
 * so switching it on never retro-grants recent accounts. Unset or unreadable
 * = the trial stays off.
 */
export function reverseTrialSince(env: Env = process.env): Date | null {
  const raw = env.REVERSE_TRIAL_SINCE?.trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function ticketRenewalEnabled(env: Env = process.env): boolean {
  return on(env, "TICKET_RENEWAL_ENABLED");
}

export function ticketReminderEmailsEnabled(env: Env = process.env): boolean {
  return on(env, "TICKET_REMINDER_EMAILS_ENABLED");
}

export function halfYearReminderEmailsEnabled(env: Env = process.env): boolean {
  return on(env, "HALF_YEAR_REMINDER_EMAILS_ENABLED");
}

export function halfYearAutoStopEnabled(env: Env = process.env): boolean {
  return on(env, "HALF_YEAR_AUTO_STOP_ENABLED");
}

/** Dry run unless the operator wrote the literal "false". */
export function halfYearAutoStopDryRun(env: Env = process.env): boolean {
  return env.HALF_YEAR_AUTO_STOP_DRY_RUN !== "false";
}
