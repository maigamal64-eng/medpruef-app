/**
 * Never sell a promise the running system cannot keep (a-pricing-v2).
 *
 *   6 months  is sold only while the renewal stop after the exam date runs
 *             for real (HALF_YEAR_AUTO_STOP_ENABLED with
 *             HALF_YEAR_AUTO_STOP_DRY_RUN=false) and the 7-day reminder is on
 *             (HALF_YEAR_REMINDER_EMAILS_ENABLED); its card says both.
 *   Ticket    is sold only while the renewal-on-proof flow is on
 *             (TICKET_RENEWAL_ENABLED) with its 30-day reminder
 *             (TICKET_REMINDER_EMAILS_ENABLED) and a ticket holder really receives the
 *             included Mentor credits: the mentor masters on, a scope that
 *             admits paid accounts (MENTOR_ACCESS_SCOPE paid or signed_in)
 *             and the raised Cohort amount (MENTOR_INCLUDED_RAISE_ENABLED,
 *             400 credits). Ticket rows get their included grant even while
 *             MENTOR_HOUSE_GRANTS_SCOPE stays allowlist-only
 *             (ticketOnlyHouseGrants, src/lib/mentor/access.ts), so selling
 *             the ticket never turns on included credits for other plans.
 * Monthly and the Sitting Pass need nothing beyond PRICING_V2_ENABLED and
 * their Whop plan ids.
 *
 * Checkout refuses an unready plan (PLAN_NOT_READY); the page shows the card
 * with a "not available yet" note instead of a button. Pure.
 */
import { halfYearAutoStopDryRun, halfYearAutoStopEnabled, halfYearReminderEmailsEnabled, ticketReminderEmailsEnabled, ticketRenewalEnabled } from "./flag";
import type { V2Tier } from "./offer";

type Env = Record<string, string | undefined>;

/**
 * a-pricing-v2-fit: the renewal guard (renewal-guard.ts) rides on the same
 * live Whop stop as stopDue, so it runs exactly when that stop is live.
 */
export function halfYearGuardLive(env: Env = process.env): boolean {
  return halfYearAutoStopEnabled(env) && !halfYearAutoStopDryRun(env);
}

export function halfYearReady(env: Env = process.env): boolean {
  return halfYearAutoStopEnabled(env) && !halfYearAutoStopDryRun(env) && halfYearReminderEmailsEnabled(env);
}

export function ticketMentorReady(env: Env = process.env): boolean {
  const scope = (env.MENTOR_ACCESS_SCOPE ?? "").trim();
  return env.AI_FEATURES_ENABLED === "true" && env.MENTOR_ENABLED === "true" &&
    (scope === "paid" || scope === "signed_in") &&
    env.MENTOR_INCLUDED_RAISE_ENABLED === "true";
}

export function ticketReady(env: Env = process.env): boolean {
  // The terms promise a mail 30 days before the end: no promise without a sender.
  return ticketRenewalEnabled(env) && ticketReminderEmailsEnabled(env) && ticketMentorReady(env);
}

export function v2PlanReady(tier: V2Tier, env: Env = process.env): boolean {
  if (tier === "half_year") return halfYearReady(env);
  if (tier === "guarantee_ticket") return ticketReady(env);
  return true;
}

export type V2Readiness = Record<V2Tier, boolean>;

export function v2Readiness(env: Env = process.env): V2Readiness {
  return {
    flex_month: true,
    sitting_pass: true,
    half_year: halfYearReady(env),
    guarantee_ticket: ticketReady(env),
  };
}
