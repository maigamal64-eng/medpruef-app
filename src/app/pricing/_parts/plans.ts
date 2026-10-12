/**
 * Pricing plan anatomy (UX-ACC-12, UX-PUB-21 option A, pick-offer-order A).
 * One shape for every paid plan: name, price as charged, an exact labelled
 * per-month figure, today's charge, the renewal or one-time line, the cancel
 * line and the button labels. Amounts come from TIERS via billingAmount, never
 * typed. Formal Sie, no em dashes.
 */
import { TIERS } from "@/lib/content-truth";
import { billingAmount, type BillingLang } from "@/lib/billing-copy";

export type PaidTier = "first_month_19" | "first_3mo_27" | "premium_pass_guaranteed";
export type Slot = "first_month" | "starter" | "cohort";

export const SLOT_FOR: Record<PaidTier, Slot> = { first_month_19: "first_month", first_3mo_27: "starter", premium_pass_guaranteed: "cohort" };
export const TIER_FOR: Record<Slot, PaidTier> = { first_month: "first_month_19", starter: "first_3mo_27", cohort: "premium_pass_guaranteed" };
/** Post-login resume actions kept for existing links. */
export const ACTION_FOR: Record<PaidTier, string> = { first_month_19: "first-month-checkout", first_3mo_27: "starter-3mo-checkout", premium_pass_guaranteed: "cohort-checkout" };
export const TIER_FOR_ACTION: Record<string, PaidTier> = Object.fromEntries(Object.entries(ACTION_FOR).map(([tier, action]) => [action, tier as PaidTier]));
/** Order on the page: the recommended 3-month plan first ([name] 2026-10-11). */
export const PLAN_ORDER: readonly PaidTier[] = ["first_3mo_27", "first_month_19", "premium_pass_guaranteed"];
export const RECOMMENDED: PaidTier = "first_3mo_27";

/** Renewal interval in days for renewing plans; null for one-time. */
export const CADENCE_DAYS: Record<PaidTier, number | null> = { first_month_19: 30, first_3mo_27: 90, premium_pass_guaranteed: null };

export interface PlanFacts {
  tier: PaidTier;
  name: string;
  /** Price as charged, e.g. "49 € für 3 Monate". */
  price: string;
  /** The amount alone (mono digits) and its period (body text), e.g. "49 €" + "für 3 Monate". */
  amount: string;
  period: string;
  /** Exact per-month figure, labelled; null for the monthly plan. */
  perMonth: string | null;
  today: string;
  renewal: string;
  cancel: string;
  cta: string;
  ctaExtend: string;
  ctaLoggedOut: string;
  guarantee: string;
}

export function priceCents(tier: PaidTier): number {
  return TIERS[tier].price_cents;
}

function months(tier: PaidTier): number {
  return TIERS[tier].duration_months;
}

export function planFacts(tier: PaidTier, lang: BillingLang): PlanFacts {
  const de = lang === "de";
  const amount = billingAmount(priceCents(tier), lang);
  const perMonthCents = months(tier) > 1 ? Math.round(priceCents(tier) / months(tier)) : null;
  const perMonth = perMonthCents === null ? null
    : de ? `entspricht rund ${billingAmount(perMonthCents, lang)} pro Monat` : `about ${billingAmount(perMonthCents, lang)} per month`;
  const loggedOut = de ? "Konto erstellen und buchen" : "Create account and book";
  if (tier === "first_month_19") {
    return {
      tier, perMonth, ctaLoggedOut: loggedOut, amount,
      name: de ? "Monatsabo" : "Monthly plan",
      price: de ? `${amount} pro Monat` : `${amount} per month`,
      period: de ? "pro Monat" : "per month",
      today: de ? `Heute ${amount}` : `${amount} today`,
      renewal: de ? `Verlängert sich automatisch alle 30 Tage mit ${amount}, bis Sie kündigen.` : `Renews automatically every 30 days at ${amount} until you cancel.`,
      cancel: de ? "Abgebucht wird zu jedem Verlängerungsdatum, bis Sie bei Whop kündigen." : "Charged on each renewal date until you cancel at Whop.",
      cta: de ? "Monatsabo starten" : "Start monthly plan",
      ctaExtend: de ? "Mit dem Monatsabo verlängern" : "Extend with the monthly plan",
      guarantee: de ? "Ohne Pass-Until-You-Pass-Garantie" : "Without the Pass-Until-You-Pass guarantee",
    };
  }
  if (tier === "first_3mo_27") {
    return {
      tier, perMonth, ctaLoggedOut: loggedOut, amount,
      name: de ? "3 Monate" : "3 months",
      price: de ? `${amount} für 3 Monate` : `${amount} for 3 months`,
      period: de ? "für 3 Monate" : "for 3 months",
      today: de ? `Heute ${amount}` : `${amount} today`,
      renewal: de ? `Verlängert sich automatisch alle 90 Tage mit ${amount}, bis Sie kündigen.` : `Renews automatically every 90 days at ${amount} until you cancel.`,
      cancel: de ? "Abgebucht wird zu jedem Verlängerungsdatum, bis Sie bei Whop kündigen." : "Charged on each renewal date until you cancel at Whop.",
      cta: de ? `3 Monate für ${amount} starten` : `Start 3 months for ${amount}`,
      ctaExtend: de ? `Um 3 Monate für ${amount} verlängern` : `Extend by 3 months for ${amount}`,
      guarantee: de ? "Ohne Pass-Until-You-Pass-Garantie" : "Without the Pass-Until-You-Pass guarantee",
    };
  }
  return {
    tier, perMonth, ctaLoggedOut: loggedOut, amount,
    name: de ? "Prüfungs-Kohorte" : "Exam Cohort",
    price: de ? `${amount} einmalig für 6 Monate` : `${amount} once for 6 months`,
    period: de ? "einmalig für 6 Monate" : "once for 6 months",
    today: de ? `Heute ${amount}` : `${amount} today`,
    renewal: de ? "Einmalzahlung, keine Verlängerung." : "One-time payment, no renewal.",
    cancel: de ? "Nichts zu kündigen: Der Zugang endet nach 6 Monaten von selbst." : "Nothing to cancel: access ends by itself after 6 months.",
    cta: de ? `6 Monate für ${amount} kaufen, einmalig` : `Buy 6 months for ${amount}, once`,
    ctaExtend: de ? `Um 6 Monate für ${amount} verlängern` : `Extend by 6 months for ${amount}`,
    guarantee: de ? "Mit Pass-Until-You-Pass-Garantie" : "With the Pass-Until-You-Pass guarantee",
  };
}

/** Long date in Vienna time, e.g. "14. November 2026". */
export function longDate(iso: string | null | undefined, lang: BillingLang): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const locale = { de: "de-AT", en: "en-GB" }[lang];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(time));
}

/**
 * The four confirm-sheet lines (UX-PUB-25 option B): plan, today's charge,
 * next charge or one-time end, and the cancel rule. `extendsFrom` is the
 * current access end for an extension; the new period starts there.
 */
export function confirmLines(tier: PaidTier, lang: BillingLang, now: Date = new Date(), extendsFrom: string | null = null): string[] {
  const de = lang === "de";
  const facts = planFacts(tier, lang);
  const amount = billingAmount(priceCents(tier), lang);
  const start = extendsFrom && Date.parse(extendsFrom) > now.getTime() ? new Date(Date.parse(extendsFrom)) : now;
  const cadence = CADENCE_DAYS[tier];
  const lines = [`${facts.name}: ${facts.price}`, de ? `Heute: ${amount}` : `Today: ${amount}`];
  if (cadence) {
    const next = longDate(new Date(now.getTime() + cadence * 86_400_000).toISOString(), lang);
    lines.push(de ? `Nächste Abbuchung am ${next} mit ${amount}, danach alle ${cadence} Tage, bis Sie kündigen.` : `Next charge on ${next} at ${amount}, then every ${cadence} days until you cancel.`);
  } else {
    const end = new Date(start); end.setMonth(end.getMonth() + months(tier));
    lines.push(de ? `Einmalzahlung, keine Verlängerung. Zugang bis ${longDate(end.toISOString(), lang)}.` : `One-time payment, no renewal. Access until ${longDate(end.toISOString(), lang)}.`);
  }
  if (extendsFrom && Date.parse(extendsFrom) > now.getTime()) {
    lines.push(de ? `Die neue Laufzeit beginnt, wenn Ihr jetziger Zugang am ${longDate(extendsFrom, lang)} endet.` : `The new period starts when your current access ends on ${longDate(extendsFrom, lang)}.`);
  }
  lines.push(facts.cancel);
  return lines;
}
