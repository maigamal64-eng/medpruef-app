import type { MentorCheckoutVerifyResponse } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import { a39T } from "./a39-copy";

/**
 * MUX-84: what the failed payment screen says. The reason comes from the
 * server (stored purchase or provider ledger), never guessed here. The support
 * reference is the buyer's own checkout correlation id from the return URL: a
 * random UUID that carries no payer data.
 */
export function failedPaymentView(reason: MentorCheckoutVerifyResponse["failure_reason"], search: string, lang: MentorUiLang) {
  const raw = new URLSearchParams(search).get("checkout_session_id") ?? "";
  const reference = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw.toLowerCase() : null;
  const email = BILLING_SUPPORT_EMAIL;
  const support = a39T("pay_support", lang, { email });
  switch (reason) {
    // Processor-confirmed decline: nothing was charged, another card may work.
    case "declined": return { title: a39T("pay_declined_title", lang), body: a39T("pay_declined", lang), support, reference: null, packages: true };
    case "refunded": return { title: a39T("pay_refunded_title", lang), body: a39T("pay_refunded", lang), support, reference, packages: true };
    case "needs_manual": return { title: a39T("pay_manual_title", lang), body: a39T("pay_manual", lang, { email, ref: reference ?? "-" }), support, reference, packages: false };
    default: return { title: null, body: a39T("pay_unknown", lang), support, reference, packages: false };
  }
}
