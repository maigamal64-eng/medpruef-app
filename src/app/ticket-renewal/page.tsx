/**
 * /ticket-renewal (a-pricing-v2): the Guarantee Ticket renewal-on-proof form.
 * A real 404 while TICKET_RENEWAL_ENABLED is off. Signed-in learners only.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ticketRenewalEnabled } from "@/lib/pricing-v2/flag";
import TicketRenewalClient from "./TicketRenewalClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Garantie-Ticket: MedPrüf", robots: { index: false, follow: false } };

export default function TicketRenewalPage() {
  if (!ticketRenewalEnabled()) notFound();
  return <TicketRenewalClient />;
}
