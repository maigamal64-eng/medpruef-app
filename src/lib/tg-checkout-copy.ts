/**
 * a-tg-checkout-context copy (Lektor gate, class transactional, verdict EDIT
 * applied 15 Oct 2026). German in Sie, no dashes. Every other UI language
 * renders English. The EUR 0 card trial has its own lines ("Pro-Test", card,
 * never "Zahlung" or "bezahlt").
 *
 * Shown only in a build with TG_CHECKOUT_OPENLINK_ENABLED=true:
 *  - opened_note / check_payment / check_trial: the purchase page after
 *    Telegram handed the Whop page to the external browser (this page stays);
 *  - return_*: /checkout/success and /mentor/checkout/success opened with no
 *    session (the external browser after paying). They read nothing private
 *    and never claim a payment arrived.
 */
export type TgCheckoutKey =
  | "opened_note"
  | "check_payment"
  | "check_trial"
  | "reopen"
  | "return_title"
  | "return_body"
  | "return_body_tg"
  | "return_body_credits"
  | "return_body_credits_tg"
  | "return_body_trial"
  | "return_body_trial_tg"
  | "return_telegram"
  | "return_no_repeat"
  | "return_no_repeat_trial";

const COPY: Record<TgCheckoutKey, { de: string; en: string }> = {
  opened_note: {
    de: "Die Whop-Seite öffnet sich in Ihrem Browser. Wenn Sie dort fertig sind, kehren Sie hierher zurück.",
    en: "The Whop page opens in your browser. When you are done there, come back here.",
  },
  check_payment: { de: "Zahlung prüfen", en: "Check payment" },
  check_trial: { de: "Status prüfen", en: "Check status" },
  reopen: { de: "Whop-Seite erneut öffnen", en: "Open the Whop page again" },
  return_title: { de: "Zurück zur App", en: "Back to the app" },
  return_body: {
    de: "In diesem Browser sind Sie nicht angemeldet. Kehren Sie zur App oder zum Fenster zurück, in dem Sie den Kauf begonnen haben. Dort sehen Sie Ihren Zugang, sobald die Zahlung bestätigt ist.",
    en: "You are not signed in in this browser. Go back to the app or window where you started the purchase. Your access appears there once the payment is confirmed.",
  },
  return_body_tg: {
    de: "Sie haben den Kauf in Telegram begonnen. Kehren Sie zu Telegram zurück und öffnen Sie MedPrüf dort wieder. Ihr Zugang erscheint dort, sobald die Zahlung bestätigt ist.",
    en: "You started the purchase in Telegram. Go back to Telegram and open MedPrüf there again. Your access appears there once the payment is confirmed.",
  },
  return_body_credits: {
    de: "In diesem Browser sind Sie nicht angemeldet. Kehren Sie zur App oder zum Fenster zurück, in dem Sie den Kauf begonnen haben. Dort sehen Sie Ihre Credits, sobald die Zahlung bestätigt ist.",
    en: "You are not signed in in this browser. Go back to the app or window where you started the purchase. Your credits appear there once the payment is confirmed.",
  },
  return_body_credits_tg: {
    de: "Sie haben den Kauf in Telegram begonnen. Kehren Sie zu Telegram zurück und öffnen Sie MedPrüf dort wieder. Ihre Credits erscheinen dort, sobald die Zahlung bestätigt ist.",
    en: "You started the purchase in Telegram. Go back to Telegram and open MedPrüf there again. Your credits appear there once the payment is confirmed.",
  },
  return_body_trial: {
    de: "In diesem Browser sind Sie nicht angemeldet. Kehren Sie zur App oder zum Fenster zurück, in dem Sie den Pro-Test begonnen haben. Dort sehen Sie Ihren Pro-Test, sobald Ihre Karte bestätigt ist.",
    en: "You are not signed in in this browser. Go back to the app or window where you started the Pro trial. Your Pro trial appears there once your card is confirmed.",
  },
  return_body_trial_tg: {
    de: "Sie haben den Pro-Test in Telegram begonnen. Kehren Sie zu Telegram zurück und öffnen Sie MedPrüf dort wieder. Ihr Pro-Test erscheint dort, sobald Ihre Karte bestätigt ist.",
    en: "You started the Pro trial in Telegram. Go back to Telegram and open MedPrüf there again. Your Pro trial appears there once your card is confirmed.",
  },
  return_telegram: { de: "Zurück zu Telegram", en: "Back to Telegram" },
  return_no_repeat: {
    de: "Falls Sie gerade bezahlt haben: Bitte bezahlen Sie nicht noch einmal.",
    en: "If you have just paid, please do not pay again.",
  },
  return_no_repeat_trial: {
    de: "Falls Sie Ihre Karte gerade hinterlegt haben: Bitte starten Sie den Pro-Test nicht noch einmal.",
    en: "If you have just added your card, please do not start the Pro trial again.",
  },
};

export function tgCheckoutCopy(key: TgCheckoutKey, lang: string): string {
  const pick: "de" | "en" = Object.hasOwn(COPY[key], lang) ? (lang as "de" | "en") : "en";
  return COPY[key][pick];
}

export const TG_CHECKOUT_COPY = COPY;
