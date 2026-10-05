/**
 * Billing-truth copy: the ONE place that states which paid plans renew
 * and how to cancel. Used by /terms, /faq (visible + FAQ JSON-LD),
 * /pricing, /settings and the expiry reminder email, so the renewal claim
 * can never drift between surfaces again (audit MP-TRUTH-01/02/19).
 *
 * Facts (owner: MEDPRUF-SOT.md section 2, verified against the live Whop
 * plans 2026-10-02):
 *   - Monthly  plan_redacted8f2b848b : 19 EUR, renews every 30 days
 *   - Quarterly plan_redacted145e2752 : 49 EUR, renews every 90 days
 *   - Exam Cohort plan_redacted324decbc : 129 EUR, ONE-TIME, 6 months
 *   - Pro trial plan_redactedec56d4df : 7 days, 0 EUR today, then 19 EUR/month
 * Legacy one-time 19/49 plans exist for grandfathered buyers only.
 *
 * Customers manage and cancel at Whop (buyer side). No em dashes.
 */

export type BillingLang = "de" | "en";

/** Whop's buyer-side membership page (documented in Whop's own help docs). */
export const WHOP_MANAGE_URL = "https://whop.com/@me/settings/memberships";
/** Same address without scheme, for plain-text copy. */
export const WHOP_MANAGE_TEXT = "whop.com/@me/settings/memberships";
export const BILLING_SUPPORT_EMAIL = "user-b7e46e80@example.com";

/** Which plans renew, which do not. */
export function billingPlansSummary(lang: BillingLang): string {
  return lang === "de"
    ? "Einzelmonat (19 € pro Monat) und 3-Monats-Tarif (49 € pro Quartal) sind Abos: Sie verlängern sich automatisch alle 30 bzw. 90 Tage und werden jeweils zum Verlängerungsdatum abgebucht, bis du kündigst. Die Prüfungs-Kohorte (129 € für 6 Monate) ist eine Einmalzahlung und verlängert sich nicht."
    : "The Single Month (19 € per month) and 3-Month (49 € per quarter) plans are subscriptions: they renew automatically every 30 or 90 days and are charged on each renewal date until you cancel. The Exam Cohort (129 € for 6 months) is a one-time payment and does not renew.";
}

/** The Pro trial conversion, stated plainly. */
export function billingTrialSummary(lang: BillingLang): string {
  return lang === "de"
    ? "Der Pro-Test startet mit hinterlegter Karte: 0 € heute, 7 Tage Pro. Wenn du nicht innerhalb der Testwoche kündigst, werden danach 19 € pro Monat abgebucht."
    : "The Pro trial starts with a card on file: 0 € today, 7 days of Pro. If you do not cancel during the trial week, 19 € per month is charged afterwards.";
}

/** How to cancel (plain text, safe for JSON-LD and emails). */
export function billingCancelSummary(lang: BillingLang): string {
  return lang === "de"
    ? `Kündigen kannst du jederzeit bei Whop unter ${WHOP_MANAGE_TEXT} (Mitgliedschaft auswählen, dann „Cancel membership“, die Whop-Oberfläche ist auf Englisch). Kündige vor dem nächsten Verlängerungsdatum, damit nicht erneut abgebucht wird. Wenn du Hilfe brauchst, schreib an ${BILLING_SUPPORT_EMAIL}.`
    : `You can cancel anytime at Whop via ${WHOP_MANAGE_TEXT} (select your membership, then "Cancel membership"). Cancel before the next renewal date so you are not charged again. If you need help, email ${BILLING_SUPPORT_EMAIL}.`;
}

/** Short neutral line for places that cannot tell which plan the user is on. */
export function billingNeutralLine(lang: BillingLang): string {
  return lang === "de"
    ? "Einzelmonat und 3-Monats-Tarif verlängern sich automatisch bis zur Kündigung. Die Prüfungs-Kohorte ist eine Einmalzahlung."
    : "The Single Month and 3-Month plans renew automatically until you cancel. The Exam Cohort is a one-time payment.";
}
