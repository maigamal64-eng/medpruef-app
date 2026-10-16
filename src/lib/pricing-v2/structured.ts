/**
 * The v2 paid offers as schema.org Offer objects (a-pricing-v2): the root
 * JSON-LD lists only plans a new buyer can purchase (never the returning-payer
 * plans). Names and amounts from the one price source (price-facts.ts).
 */
import { planName, planPrice, planPriceCents } from "./price-facts";

const CARD = "Payable by card (Visa, Mastercard, Apple Pay).";

export function v2JsonLdOffers() {
  const offer = (name: string, cents: number, description: string) => ({
    "@type": "Offer",
    "name": name,
    "price": String(cents / 100),
    "priceCurrency": "EUR",
    "availability": "https://schema.org/InStock",
    "description": `${description} ${CARD}`,
  });
  return [
    offer(planName("flex_month", "en"), planPriceCents("flex_month"), `Full access at ${planPrice("flex_month", "en")}, renews every 30 days until cancelled at Whop.`),
    offer(planName("sitting_pass", "en"), planPriceCents("sitting_pass"), "One payment: full access until the day after the official sitting you choose, at least 30 days and at most 3 months. Does not renew."),
    offer(planName("half_year", "en"), planPriceCents("half_year"), `Full access at ${planPrice("half_year", "en")}, renews every 180 days until cancelled at Whop; it stops renewing once your exam date has passed.`),
    offer(planName("guarantee_ticket", "en"), planPriceCents("guarantee_ticket"), "One payment: 12 months of full access, and up to two free renewal years on proof of a failed official result or a sitting booked after the ticket ends. A renewal year extends access and is not a cash refund; the 7-day refund still applies."),
  ];
}
