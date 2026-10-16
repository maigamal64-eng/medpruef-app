/**
 * One price source for every v2 surface (a-pricing-v2-fit, fast-money F4/F5).
 *
 * Plan names and amounts come from here, amounts from content-truth TIERS:
 * the pricing cards (plans.ts), the landing preview (landing-preview.ts),
 * the root JSON-LD (structured.ts), llms.txt and llms-full.txt
 * (agent-docs/render-llms.ts) and the access-ending mail all read these
 * functions, so a price change in TIERS moves every surface together
 * (tests/unit/a-pricing-v2-fit/one-price-source.test.ts).
 *
 * The returning-payer plans (decision returning-payer-price, D-A) are the
 * two old recurring plans, never the retired one-time Cohort; they appear
 * only in-app for eligible signed-in learners and in their own
 * access-ending mail, never on a public surface.
 *
 * Pure, client-safe.
 */
import { TIERS } from "@/lib/content-truth";
import { billingAmount, type BillingLang } from "@/lib/billing-copy";
import type { V2Tier } from "./offer";

export type ReturningTier = "first_month_19" | "first_3mo_27";
export const RETURNING_TIERS: readonly ReturningTier[] = ["first_month_19", "first_3mo_27"];

export function isReturningTier(tier: unknown): tier is ReturningTier {
  return typeof tier === "string" && (RETURNING_TIERS as readonly string[]).includes(tier);
}

export const V2_PLAN_NAMES: Record<V2Tier, { de: string; en: string }> = {
  flex_month: { de: "Monatsabo", en: "Monthly plan" },
  sitting_pass: { de: "Prüfungspass", en: "Sitting Pass" },
  half_year: { de: "6 Monate", en: "6 months" },
  guarantee_ticket: { de: "Garantie-Ticket", en: "Guarantee Ticket" },
};

export const RETURNING_PLAN_NAMES: Record<ReturningTier, { de: string; en: string }> = {
  first_month_19: { de: "Monatsabo", en: "Monthly plan" },
  first_3mo_27: { de: "3 Monate", en: "3 months" },
};

/** Renewal interval of the returning plans (days). */
export const RETURNING_CADENCE_DAYS: Record<ReturningTier, number> = { first_month_19: 30, first_3mo_27: 90 };

export function planPriceCents(tier: V2Tier | ReturningTier): number {
  return TIERS[tier].price_cents;
}

/** The amount as the learner reads it ("24 €"). */
export function planPrice(tier: V2Tier | ReturningTier, lang: BillingLang): string {
  return billingAmount(planPriceCents(tier), lang);
}

/** The agent files' format ("€24"), same cents. */
export function planPriceAgent(tier: V2Tier): string {
  return `€${planPriceCents(tier) / 100}`;
}

export function planName(tier: V2Tier | ReturningTier, lang: BillingLang): string {
  return (tier in V2_PLAN_NAMES ? V2_PLAN_NAMES[tier as V2Tier] : RETURNING_PLAN_NAMES[tier as ReturningTier])[lang];
}
