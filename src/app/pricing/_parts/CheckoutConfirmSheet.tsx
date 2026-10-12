"use client";
/**
 * Confirm step before Whop (UX-PUB-25 option B, default-off flag
 * NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED). Four lines on the shared Dialog:
 * plan, today's charge, next charge or one-time end, cancel rule; one 48 px
 * "Weiter zur Zahlung" and "Zurück zu den Tarifen". It is also the resume stop
 * after login while the flag is on, so nothing is charged without it.
 */
import { useRef } from "react";
import { Dialog } from "@/components/ui";
import type { BillingLang } from "@/lib/billing-copy";
import { confirmLines, planFacts, type PaidTier } from "./plans";

export const CHECKOUT_CONFIRM_ENABLED = process.env.NEXT_PUBLIC_CHECKOUT_CONFIRM_ENABLED === "true";

export default function CheckoutConfirmSheet({ tier, lang, extendsFrom, email, onConfirm, onClose }: {
  tier: PaidTier | null;
  lang: BillingLang;
  extendsFrom: string | null;
  email: string | null;
  onConfirm: (tier: PaidTier) => void;
  onClose: () => void;
}) {
  const de = lang === "de";
  const go = useRef<HTMLButtonElement>(null);
  if (!tier) return null;
  const lines = confirmLines(tier, lang, new Date(), extendsFrom);
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={de ? `${planFacts(tier, lang).name}: Zahlung bestätigen` : `${planFacts(tier, lang).name}: confirm payment`}
      placement="auto"
      kind="confirm"
      initialFocus={go}
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2 w-full sm:justify-end">
          <button type="button" className="mp-btn mp-btn--secondary min-h-12" onClick={onClose}>{de ? "Zurück zu den Tarifen" : "Back to plans"}</button>
          <button ref={go} type="button" className="mp-btn mp-btn--success min-h-12" onClick={() => onConfirm(tier)}>{de ? "Weiter zur Zahlung" : "Continue to payment"}</button>
        </div>
      }
    >
      <ul className="space-y-2 text-sm m-0 ps-0 list-none">
        {lines.map((line) => <li key={line} className="tabular-nums">{line}</li>)}
      </ul>
      <p className="text-sm text-[var(--mp-fg-muted)] mt-3">{de ? "Die Quittung sendet Whop an die E-Mail-Adresse, die Sie dort angeben." : "Whop sends the receipt to the email address you enter there."}</p>
      {email && <p className="text-sm text-[var(--mp-fg-muted)] mt-1">{de ? `Ihr MedPrüf-Konto: ${email}. Nutzen Sie bei Whop am besten dieselbe Adresse, dann ordnen wir die Zahlung sofort zu.` : `Your MedPrüf account: ${email}. Use the same address at Whop so we can link the payment at once.`}</p>}
      <p className="text-sm text-[var(--mp-fg-muted)] mt-2">{de ? "Die Zahlung läuft über Whop (Karte oder Apple Pay). Mit „Zurück“ kommen Sie auf diese Seite zurück." : "Payment runs through Whop (card or Apple Pay). Use Back to return to this page."}</p>
    </Dialog>
  );
}
