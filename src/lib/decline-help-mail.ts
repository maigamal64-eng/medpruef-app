/**
 * a-trial-decline-mail-1103: a learner whose card was declined when starting the
 * card trial got no mail (Whop sends payment.failed with recovery_url null).
 * With DECLINE_HELP_MAIL_ENABLED on, that case gets ONE transactional note per
 * learner per day telling them nothing was charged and what to try next.
 * Renewals (billing_reason subscription_cycle) keep the existing dunning mail.
 */

import { billingAmount } from "@/lib/billing-copy";
import { TIERS } from "@/lib/content-truth";

export function declineHelpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DECLINE_HELP_MAIL_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** processed_webhook_events key: one mail per learner per UTC day. */
export function declineHelpKey(userId: string, now: Date = new Date()): string {
  return `decline-help:${userId}:${now.toISOString().slice(0, 10)}`;
}

export const DECLINE_HELP_URL = "https://medpruf.com/pricing#pro-test";
/** The monthly plan (tier flex_month) on the pricing page. */
export const DECLINE_HELP_MONTHLY_URL = "https://medpruf.com/pricing#plans";

/** Hold on the automatic mail after a FIRST purchase fails (a-trial-checkout-1104). */
export const FIRST_PURCHASE_HOLD_MS = 30 * 60_000;

export function firstPurchaseHoldEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DUNNING_FIRST_HOLD_ENABLED ?? "").trim().toLowerCase() === "true";
}

/**
 * A failed FIRST charge (trial start or first purchase), as opposed to a
 * renewal. Same rule as isDeclineHelpCase without the plan filter: a payload
 * without billing_reason counts only for a learner who is not on a paid tier.
 */
export function isFirstPurchaseFailure(input: { billingReason: string | null; userTier: string | null }): boolean {
  const reason = (input.billingReason ?? "").toLowerCase();
  if (reason === "subscription_create") return true;
  if (reason) return false;
  return (input.userTier ?? "free").toLowerCase() === "free";
}

/**
 * True when the failed payment is a trial start or first charge without a
 * recovery link. A renewal never qualifies; a payload without billing_reason
 * qualifies only for a learner who is not on a paid tier (tier free).
 */
export function isDeclineHelpCase(input: {
  enabled: boolean;
  recoveryUrl: string | null;
  billingReason: string | null;
  userTier: string | null;
  /** The payment belongs to the card-trial plan. */
  isTrialPlan: boolean;
}): boolean {
  if (!input.enabled || input.recoveryUrl || !input.isTrialPlan) return false;
  const reason = (input.billingReason ?? "").toLowerCase();
  if (reason === "subscription_create") return true;
  if (reason) return false;
  return (input.userTier ?? "free").toLowerCase() === "free";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDeclineHelpMail(opts: { isDe: boolean; firstName: string | null }): { subject: string; html: string } {
  const name = opts.firstName ? ` ${esc(opts.firstName)}` : "";
  const month = billingAmount(TIERS.flex_month.price_cents, opts.isDe ? "de" : "en");
  if (opts.isDe) {
    return {
      subject: "Ihre MedPrüf-Testphase: Ihre Karte wurde abgelehnt",
      html:
        `<p>Hallo${name},</p>` +
        `<p>Ihre Bank hat die Karte beim Start Ihrer MedPrüf-Testphase abgelehnt. Es wurde nichts abgebucht. Debit- und Prepaid-Karten lehnen die Kartenprüfung zum Start häufig ab.</p>` +
        `<p>Sie haben zwei einfache Möglichkeiten:</p>` +
        `<p>1. Mit einer anderen Karte oder einer anderen Zahlungsart erneut versuchen: <a href="${DECLINE_HELP_URL}">${DECLINE_HELP_URL}</a></p>` +
        `<p>2. Direkt den Monatstarif nehmen (${month} alle 30 Tage, bis Sie kündigen): <a href="${DECLINE_HELP_MONTHLY_URL}">${DECLINE_HELP_MONTHLY_URL}</a></p>` +
        `<p>Wenn ich helfen soll, antworten Sie einfach auf diese E-Mail.</p>` +
        `<p>Viele Grüße<br>[name]</p>`,
    };
  }
  return {
    subject: "Your MedPrüf trial: your card was declined",
    html:
      `<p>Hi${name},</p>` +
      `<p>Your bank declined the card when you started your MedPrüf trial. Nothing was charged. Debit and prepaid cards often refuse the card check at the start.</p>` +
      `<p>You have two simple choices:</p>` +
      `<p>1. Try again with another card or another payment method: <a href="${DECLINE_HELP_URL}">${DECLINE_HELP_URL}</a></p>` +
      `<p>2. Take the monthly plan right away (${month} every 30 days, until you cancel): <a href="${DECLINE_HELP_MONTHLY_URL}">${DECLINE_HELP_MONTHLY_URL}</a></p>` +
      `<p>If you would like help, just reply to this email.</p>` +
      `<p>Best<br>[name]</p>`,
  };
}
