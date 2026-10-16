/**
 * a-checkout-confirm-v2: Lektor-final lines of the confirm step and the
 * matching /pricing method line (lektor-verdict.json of a-checkout-drop-audit,
 * C1 APPROVE, C2 EDIT: these are the final strings, not the drafts).
 *
 * C1 lists no payment method: Whop shows the ones available in the buyer's
 * country. C2 (bank transfer) renders only while Whop shows bank transfer for
 * EUR plans, which track-A confirms on the hosted page before switching
 * NEXT_PUBLIC_CHECKOUT_BANK_TRANSFER_NOTE on (default off).
 */
export const CHECKOUT_BANK_TRANSFER_NOTE_ENABLED = process.env.NEXT_PUBLIC_CHECKOUT_BANK_TRANSFER_NOTE === "true";

type Pair = { de: string; en: string };

/** C1, whole sheet line. */
export const CONFIRM_METHOD_LINE: Pair = {
  de: "Die Zahlung läuft über Whop. Dort sehen Sie die Zahlungsarten, die für Ihr Land verfügbar sind. Mit „Zurück“ kommen Sie auf diese Seite zurück.",
  en: "Payment runs through Whop, which shows the payment methods available in your country. Use Back to return to this page.",
};

/** C1 first two sentences, reused on /pricing (footer and "How can I pay?") so the page names no method either. */
export const METHOD_SENTENCE: Pair = {
  de: "Die Zahlung läuft über Whop. Dort sehen Sie die Zahlungsarten, die für Ihr Land verfügbar sind.",
  en: "Payment runs through Whop, which shows the payment methods available in your country.",
};

/** C2. */
export const BANK_TRANSFER_NOTE: Pair = {
  de: "Eine Banküberweisung wird erst bestätigt, wenn sie eingegangen ist. Das kann dauern. Danach schalten wir Ihren Zugang frei. Bitte bezahlen Sie in dieser Zeit nicht noch einmal.",
  en: "A bank transfer is confirmed only once it arrives. This can take a while. We then unlock your access. Please do not pay again in the meantime.",
};

export type ConfirmSource = "pricing";
