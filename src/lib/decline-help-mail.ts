/**
 * a-trial-decline-mail-1103: a learner whose card was declined when starting the
 * card trial got no mail (Whop sends payment.failed with recovery_url null).
 * With DECLINE_HELP_MAIL_ENABLED on, that case gets ONE transactional note per
 * learner per day telling them nothing was charged and what to try next.
 * Renewals (billing_reason subscription_cycle) keep the existing dunning mail.
 */

export function declineHelpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.DECLINE_HELP_MAIL_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** processed_webhook_events key: one mail per learner per UTC day. */
export function declineHelpKey(userId: string, now: Date = new Date()): string {
  return `decline-help:${userId}:${now.toISOString().slice(0, 10)}`;
}

export const DECLINE_HELP_URL = "https://medpruf.com/pricing";

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
  if (opts.isDe) {
    return {
      subject: "Ihre MedPrüf-Testphase: Ihre Karte wurde abgelehnt",
      html:
        `<p>Hallo${name},</p>` +
        `<p>Ihre Bank hat die Karte beim Start Ihrer MedPrüf-Testphase abgelehnt. Es wurde nichts abgebucht. Debit- und Prepaid-Karten lehnen die Kartenprüfung zum Start häufig ab.</p>` +
        `<p>Bitte versuchen Sie es mit einer anderen Karte oder mit einer der anderen Zahlungsarten, die die Zahlungsseite anbietet:</p>` +
        `<p><a href="${DECLINE_HELP_URL}">${DECLINE_HELP_URL}</a></p>` +
        `<p>Wenn ich helfen soll, antworten Sie einfach auf diese E-Mail.</p>` +
        `<p>Viele Grüße<br>[name]</p>`,
    };
  }
  return {
    subject: "Your MedPrüf trial: your card was declined",
    html:
      `<p>Hi${name},</p>` +
      `<p>Your bank declined the card when you started your MedPrüf trial. Nothing was charged. Debit and prepaid cards often refuse the card check at the start.</p>` +
      `<p>Please try another card, or one of the other payment methods the payment page offers:</p>` +
      `<p><a href="${DECLINE_HELP_URL}">${DECLINE_HELP_URL}</a></p>` +
      `<p>If you would like help, just reply to this email.</p>` +
      `<p>Best<br>[name]</p>`,
  };
}
