"use client";
/**
 * Confirm step before Whop (UX-PUB-25 option B, default-off flag
 * NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED). Four lines on the shared Dialog:
 * plan, today's charge, next charge or one-time end, cancel rule; one 48 px
 * "Weiter zur Zahlung" and "Zurück zu den Tarifen". It is also the resume stop
 * after login while the flag is on, so nothing is charged without it.
 * a-checkout-confirm-v2: the method line is the Lektor C1 line (no method
 * named), C2 (bank transfer) only behind NEXT_PUBLIC_CHECKOUT_BANK_TRANSFER_NOTE,
 * and the counts-only events checkout_confirm_shown / _continue / _back.
 */
import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/tracker";
import { BANK_TRANSFER_NOTE, CHECKOUT_BANK_TRANSFER_NOTE_ENABLED, CONFIRM_METHOD_LINE } from "@/lib/checkout-confirm-copy";
import { Dialog } from "@/components/ui";
import type { BillingLang } from "@/lib/billing-copy";
import { confirmLines, planFacts, type PaidTier } from "./plans";

export const CHECKOUT_CONFIRM_ENABLED = process.env.NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED === "true";

export default function CheckoutConfirmSheet({ tier, lang, extendsFrom, email, onConfirm, onClose, sittingLastDay = null, switching = false }: {
  tier: PaidTier | null;
  lang: BillingLang;
  extendsFrom: string | null;
  /** a-renew-early: this plan replaces a plan that still renews. */
  switching?: boolean;
  /** a-pricing-v2: the Sitting Pass end follows the chosen sitting. */
  sittingLastDay?: string | null;
  email: string | null;
  onConfirm: (tier: PaidTier) => void;
  onClose: () => void;
}) {
  const de = lang === "de";
  const go = useRef<HTMLButtonElement>(null);
  const continued = useRef(false);
  // Counts only (tier key + surface): shown once per opening, then continue or back.
  useEffect(() => { continued.current = false; if (tier) CHECKOUT_CONFIRM_ENABLED && trackEvent("checkout_confirm_shown", { tier, source: "pricing" }); }, [tier]);
  if (!tier) return null;
  const back = () => { if (continued.current) return; if (CHECKOUT_CONFIRM_ENABLED) trackEvent("checkout_confirm_back", { tier, source: "pricing" }); onClose(); };
  const lines = confirmLines(tier, lang, new Date(), extendsFrom, sittingLastDay, switching);
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) back(); }}
      title={de ? `${planFacts(tier, lang).name}: Zahlung bestätigen` : `${planFacts(tier, lang).name}: confirm payment`}
      placement="auto"
      kind="confirm"
      initialFocus={go}
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:justify-end">
          <button type="button" className="mp-btn mp-btn--secondary min-h-12" onClick={back}>{de ? "Zurück zu den Tarifen" : "Back to plans"}</button>
          <button ref={go} type="button" className="mp-btn mp-btn--success min-h-12" onClick={() => { continued.current = true; if (CHECKOUT_CONFIRM_ENABLED) trackEvent("checkout_confirm_continue", { tier, source: "pricing" }); onConfirm(tier); }}>{de ? "Weiter zur Zahlung" : "Continue to payment"}</button>
        </div>
      }
    >
      <ul className="space-y-2 text-sm m-0 ps-0 list-none">
        {lines.map((line) => <li key={line} className="tabular-nums">{line}</li>)}
      </ul>
      <p className="text-sm text-[var(--mp-fg-muted)] mt-3">{de ? "Die Quittung sendet Whop an die E-Mail-Adresse, die Sie dort angeben." : "Whop sends the receipt to the email address you enter there."}</p>
      {email && <p className="text-sm text-[var(--mp-fg-muted)] mt-1">{de ? `Ihr MedPrüf-Konto: ${email}. Nutzen Sie bei Whop am besten dieselbe Adresse, dann ordnen wir die Zahlung sofort zu.` : `Your MedPrüf account: ${email}. Use the same address at Whop so we can link the payment at once.`}</p>}
      <p className="text-sm text-[var(--mp-fg-muted)] mt-2" data-confirm-method>{CHECKOUT_CONFIRM_ENABLED ? CONFIRM_METHOD_LINE[de ? "de" : "en"] : (de ? "Die Zahlung läuft über Whop (Karte oder Apple Pay). Mit „Zurück“ kommen Sie auf diese Seite zurück." : "Payment runs through Whop (card or Apple Pay). Use Back to return to this page.")}</p>
      {CHECKOUT_CONFIRM_ENABLED && CHECKOUT_BANK_TRANSFER_NOTE_ENABLED && <p className="text-sm text-[var(--mp-fg-muted)] mt-2" data-confirm-bank-transfer>{BANK_TRANSFER_NOTE[de ? "de" : "en"]}</p>}
    </Dialog>
  );
}
