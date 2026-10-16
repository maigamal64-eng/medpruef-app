/**
 * Pricing plan anatomy (UX-ACC-12, UX-PUB-21 option A, pick-offer-order A).
 * One shape for every paid plan: name, price as charged, an exact labelled
 * per-month figure, today's charge, the renewal or one-time line, the cancel
 * line and the button labels. Amounts come from TIERS via billingAmount, never
 * typed. Formal Sie, no em dashes.
 */
import { TIERS } from "@/lib/content-truth";
import { billingAmount, type BillingLang } from "@/lib/billing-copy";
import { V2_CADENCE_DAYS, type V2Tier } from "@/lib/pricing-v2/offer";
import { sittingPassEnd } from "@/lib/pricing-v2/sitting-pass";
import { planName, planPrice } from "@/lib/pricing-v2/price-facts";

export type V1PaidTier = "first_month_19" | "first_3mo_27" | "premium_pass_guaranteed";
/** a-pricing-v2: the v2 plans join the same anatomy (offer in src/lib/pricing-v2/offer.ts). */
export type PaidTier = V1PaidTier | V2Tier;
export type Slot = "first_month" | "starter" | "cohort" | "flex" | "pass" | "half" | "ticket";

export const SLOT_FOR: Record<PaidTier, Slot> = {
  first_month_19: "first_month", first_3mo_27: "starter", premium_pass_guaranteed: "cohort",
  flex_month: "flex", sitting_pass: "pass", half_year: "half", guarantee_ticket: "ticket",
};
export const TIER_FOR: Record<Slot, PaidTier> = {
  first_month: "first_month_19", starter: "first_3mo_27", cohort: "premium_pass_guaranteed",
  flex: "flex_month", pass: "sitting_pass", half: "half_year", ticket: "guarantee_ticket",
};
/** Post-login resume actions kept for existing links. */
export const ACTION_FOR: Record<PaidTier, string> = {
  first_month_19: "first-month-checkout", first_3mo_27: "starter-3mo-checkout", premium_pass_guaranteed: "cohort-checkout",
  flex_month: "flex-month-checkout", sitting_pass: "sitting-pass-checkout", half_year: "half-year-checkout", guarantee_ticket: "ticket-checkout",
};
export const TIER_FOR_ACTION: Record<string, PaidTier> = Object.fromEntries(Object.entries(ACTION_FOR).map(([tier, action]) => [action, tier as PaidTier]));
/** Order on the page: the recommended 3-month plan first ([name] 2026-10-11). */
export const PLAN_ORDER: readonly PaidTier[] = ["first_3mo_27", "first_month_19", "premium_pass_guaranteed"];
export const RECOMMENDED: PaidTier = "first_3mo_27";

/** Renewal interval in days for renewing plans; null for one-time. */
export const CADENCE_DAYS: Record<PaidTier, number | null> = { first_month_19: 30, first_3mo_27: 90, premium_pass_guaranteed: null, ...V2_CADENCE_DAYS };

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
  if (tier === "flex_month" || tier === "sitting_pass" || tier === "half_year" || tier === "guarantee_ticket") return planFactsV2(tier, lang);
  const de = lang === "de";
  const amount = billingAmount(priceCents(tier), lang);
  const perMonthCents = months(tier) > 1 ? Math.round(priceCents(tier) / months(tier)) : null;
  const perMonth = perMonthCents === null ? null
    : de ? `entspricht rund ${billingAmount(perMonthCents, lang)} pro Monat` : `about ${billingAmount(perMonthCents, lang)} per month`;
  const loggedOut = de ? "Konto erstellen und buchen" : "Create account and book";
  if (tier === "first_month_19") {
    return {
      tier, perMonth, ctaLoggedOut: loggedOut, amount,
      name: planName("first_month_19", lang),
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
      name: planName("first_3mo_27", lang),
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

/**
 * The v2 plans (a-pricing-v2). Same anatomy, formal Sie, amounts from TIERS.
 * Copy reviewed by the Content Steward (Lektor) before release.
 */
function planFactsV2(tier: V2Tier, lang: BillingLang): PlanFacts {
  const de = lang === "de";
  // a-pricing-v2-fit: names and amounts from the one price source (price-facts.ts).
  const amount = planPrice(tier, lang);
  const name = planName(tier, lang);
  const loggedOut = de ? "Konto erstellen und buchen" : "Create account and book";
  const noGuarantee = de ? "Ohne kostenlose Verlängerungsjahre" : "Without free renewal years";
  const oneTimeCancel = de ? "Nichts zu kündigen: Der Zugang endet von selbst." : "Nothing to cancel: access ends by itself.";
  const renewCancel = de ? "Abgebucht wird zu jedem Verlängerungsdatum, bis Sie bei Whop kündigen." : "Charged on each renewal date until you cancel at Whop.";
  if (tier === "flex_month") {
    return {
      tier, perMonth: null, ctaLoggedOut: loggedOut, amount,
      name,
      price: de ? `${amount} pro Monat` : `${amount} per month`,
      period: de ? "pro Monat" : "per month",
      today: de ? `Heute ${amount}` : `${amount} today`,
      renewal: de ? `Verlängert sich automatisch alle 30 Tage mit ${amount}, bis Sie kündigen.` : `Renews automatically every 30 days at ${amount} until you cancel.`,
      cancel: renewCancel,
      cta: de ? "Monatsabo starten" : "Start monthly plan",
      ctaExtend: de ? "Mit dem Monatsabo verlängern" : "Extend with the monthly plan",
      guarantee: noGuarantee,
    };
  }
  if (tier === "sitting_pass") {
    return {
      tier, perMonth: null, ctaLoggedOut: loggedOut, amount,
      name,
      price: de ? `${amount} einmalig bis zu Ihrem Termin` : `${amount} once, until your exam`,
      period: de ? "einmalig bis zu Ihrem Termin" : "once, until your exam",
      today: de ? `Heute ${amount}` : `${amount} today`,
      renewal: de
        ? "Einmalzahlung, keine Verlängerung. Ihr Zugang läuft bis zum Tag nach dem Termin, den Sie wählen: mindestens 30 Tage, höchstens 3 Monate."
        : "One-time payment, no renewal. Your access runs until the day after the sitting you choose: at least 30 days, at most 3 months.",
      cancel: oneTimeCancel,
      cta: de ? `Prüfungspass für ${amount} kaufen` : `Buy the Sitting Pass for ${amount}`,
      ctaExtend: de ? `Prüfungspass für ${amount} kaufen` : `Buy the Sitting Pass for ${amount}`,
      guarantee: noGuarantee,
    };
  }
  if (tier === "half_year") {
    const perMonthCents = Math.round(priceCents(tier) / 6);
    return {
      tier, ctaLoggedOut: loggedOut, amount,
      perMonth: de ? `entspricht rund ${billingAmount(perMonthCents, lang)} pro Monat` : `about ${billingAmount(perMonthCents, lang)} per month`,
      name,
      price: de ? `${amount} für 6 Monate` : `${amount} for 6 months`,
      period: de ? "für 6 Monate" : "for 6 months",
      today: de ? `Heute ${amount}` : `${amount} today`,
      renewal: de
        ? `Verlängert sich automatisch alle 180 Tage mit ${amount}, bis Sie kündigen. Ist der Prüfungstermin vorbei, den Sie oben wählen oder in den Einstellungen speichern, verlängert er sich nicht mehr. 7 Tage vor jeder Verlängerung erinnern wir Sie per E-Mail.`
        : `Renews automatically every 180 days at ${amount} until you cancel. Once the exam date you choose above or save in Settings has passed, it stops renewing. We remind you by email 7 days before every renewal.`,
      cancel: renewCancel,
      cta: de ? `6 Monate für ${amount} starten` : `Start 6 months for ${amount}`,
      ctaExtend: de ? `Um 6 Monate für ${amount} verlängern` : `Extend by 6 months for ${amount}`,
      guarantee: noGuarantee,
    };
  }
  const perMonthCents = Math.round(priceCents(tier) / 12);
  return {
    tier, ctaLoggedOut: loggedOut, amount,
    perMonth: de ? `entspricht rund ${billingAmount(perMonthCents, lang)} pro Monat` : `about ${billingAmount(perMonthCents, lang)} per month`,
    name,
    price: de ? `${amount} einmalig für 12 Monate` : `${amount} once for 12 months`,
    period: de ? "einmalig für 12 Monate" : "once for 12 months",
    today: de ? `Heute ${amount}` : `${amount} today`,
    renewal: de ? "Einmalzahlung, keine automatische Verlängerung." : "One-time payment, no automatic renewal.",
    cancel: de ? "Nichts zu kündigen: Der Zugang endet nach 12 Monaten, außer Sie erhalten ein Verlängerungsjahr." : "Nothing to cancel: access ends after 12 months unless you receive a renewal year.",
    cta: de ? `Garantie-Ticket für ${amount} kaufen` : `Buy the Guarantee Ticket for ${amount}`,
    ctaExtend: de ? `Garantie-Ticket für ${amount} kaufen` : `Buy the Guarantee Ticket for ${amount}`,
    guarantee: de ? "Mit bis zu zwei kostenlosen Verlängerungsjahren auf Nachweis" : "With up to two free renewal years on proof",
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

/** a-renew-early: confirm-sheet line for a switch from a plan that still renews (Lektor APPROVE with edits, 15 Oct 2026: states the action, never the result). */
export const SWITCH_CONFIRM_LINE = {
  de: "Ihr bisheriges Abo kündigen wir für Sie zum Ende des laufenden Zeitraums, sobald diese Zahlung bestätigt ist. Ob die Kündigung eingetragen ist, sehen Sie unter „Abo bei Whop verwalten“.",
  en: "We cancel your current plan for you at the end of its current period once this payment is confirmed. You can check that the cancellation is recorded under \"Manage your plan at Whop\".",
} as const;

/**
 * The four confirm-sheet lines (UX-PUB-25 option B): plan, today's charge,
 * next charge or one-time end, and the cancel rule. `extendsFrom` is the
 * current access end for an extension; the new period starts there.
 */
export function confirmLines(tier: PaidTier, lang: BillingLang, now: Date = new Date(), extendsFrom: string | null = null, sittingLastDay: string | null = null, switching = false): string[] {
  const de = lang === "de";
  const facts = planFacts(tier, lang);
  const amount = billingAmount(priceCents(tier), lang);
  const start = extendsFrom && Date.parse(extendsFrom) > now.getTime() ? new Date(Date.parse(extendsFrom)) : now;
  const cadence = CADENCE_DAYS[tier];
  const lines = [`${facts.name}: ${facts.price}`, de ? `Heute: ${amount}` : `Today: ${amount}`];
  if (cadence) {
    const next = longDate(new Date(now.getTime() + cadence * 86_400_000).toISOString(), lang);
    lines.push(de ? `Nächste Abbuchung am ${next} mit ${amount}, danach alle ${cadence} Tage, bis Sie kündigen.` : `Next charge on ${next} at ${amount}, then every ${cadence} days until you cancel.`);
    // a-pricing-v2: the 6-month plan stops renewing after the exam date.
    if (tier === "half_year") lines.push(de ? "Ist Ihr Prüfungstermin vorbei, verlängert sich der Tarif nicht mehr." : "Once your exam date has passed, the plan stops renewing.");
  } else {
    // a-pricing-v2: the Sitting Pass ends the day after the chosen sitting
    // (30 days to 3 months, the same rule the grant applies).
    const end = tier === "sitting_pass" ? sittingPassEnd(sittingLastDay, now) : new Date(start);
    if (tier !== "sitting_pass") end.setMonth(end.getMonth() + months(tier));
    lines.push(de ? `Einmalzahlung, keine Verlängerung. Zugang bis ${longDate(end.toISOString(), lang)}.` : `One-time payment, no renewal. Access until ${longDate(end.toISOString(), lang)}.`);
  }
  if (extendsFrom && Date.parse(extendsFrom) > now.getTime()) {
    lines.push(de ? `Die neue Laufzeit beginnt, wenn Ihr jetziger Zugang am ${longDate(extendsFrom, lang)} endet.` : `The new period starts when your current access ends on ${longDate(extendsFrom, lang)}.`);
    // a-renew-early: the plan that still renews is stopped after this payment.
    if (switching) lines.push(SWITCH_CONFIRM_LINE[de ? "de" : "en"]);
  }
  lines.push(facts.cancel);
  return lines;
}
