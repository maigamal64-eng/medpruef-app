"use client";
/**
 * The Guarantee Ticket's renewal terms inside its card only (a-pricing-v2),
 * the same native details/summary as PuypDetails. Copy from
 * src/lib/pricing-v2/ticket.ts.
 */
import type { BillingLang } from "@/lib/billing-copy";
import { ticketNotRefund, ticketTerms } from "@/lib/pricing-v2/ticket";

export default function TicketDetails({ lang, mentorCredits }: { lang: BillingLang; mentorCredits: number | null }) {
  const de = lang === "de";
  return (
    <details className="group rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] mt-1">
      <summary className="cursor-pointer list-none min-h-11 flex items-center px-3 text-sm font-semibold text-[var(--mp-fg)]">
        {de ? "So funktioniert das Garantie-Ticket" : "How the Guarantee Ticket works"}
      </summary>
      <div className="px-3 pb-3 text-sm text-[var(--mp-fg-muted)] space-y-2">
        <dl className="space-y-2 m-0">
          {ticketTerms(lang, mentorCredits).map((row) => (
            <div key={row.label}>
              <dt className="font-semibold text-[var(--mp-fg)]">{row.label}</dt>
              <dd className="m-0">{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0">{ticketNotRefund(lang)}</p>
      </div>
    </details>
  );
}
