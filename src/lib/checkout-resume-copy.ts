/**
 * Checkout resume card copy (a-checkout-resume). DE formal Sie and EN, Lektor
 * edits applied. No urgency, no scarcity, no price-change wording. Plan names
 * and prices come from planFacts (one price owner); totals from plan-cover.
 * Renewing plans say the total holds unless the learner cancels at Whop; the
 * Cohort says it is one payment. Pure.
 */
import { billingAmount, BILLING_SUPPORT_EMAIL, type BillingLang } from "@/lib/billing-copy";
import { CADENCE_DAYS, planFacts } from "@/app/pricing/_parts/plans";
import type { ResumeFit } from "@/lib/checkout-resume";
import type { CoverPlan } from "@/lib/plan-cover";

export interface ResumeCopy {
  title: string;
  body: string;
  /** Sitting fit lines; empty without a saved sitting. */
  fit: string[];
  primary: string;
  cheaper: string | null;
  help: string;
  helpLink: string;
  helpMailto: string;
  dismiss: string;
}

export function resumeLang(lang: string): BillingLang {
  const de = lang === "de";
  return de ? "de" : "en";
}

/** "den Tarif 3 Monate" / `the "3 months" plan`: the name never reads like a duration. */
function planRef(name: string): { acc: string; dat: string; en: string } {
  return { acc: `den Tarif ${name}`, dat: `dem Tarif ${name}`, en: /plan$/i.test(name) ? `the ${name}` : `the "${name}" plan` };
}

export function resumeCopy(tier: CoverPlan, fit: ResumeFit | null, lang: BillingLang): ResumeCopy {
  const de = lang === "de";
  const opened = planFacts(tier, lang);
  const ref = planRef(opened.name);
  const renews = CADENCE_DAYS[tier] !== null;
  const fitLines: string[] = [];
  let cheaper: string | null = null;
  if (fit) {
    const mine = billingAmount(fit.openedTotalCents, lang);
    const m = fit.months;
    const away = de
      ? `Bis zu Ihrem eingetragenen Prüfungstermin (Ihre eigene Angabe) sind es etwa ${m} ${m === 1 ? "Monat" : "Monate"}.`
      : `Your saved exam date (your own entry) is about ${m} ${m === 1 ? "month" : "months"} away.`;
    const total = renews
      ? (de ? `Mit ${ref.dat} ergibt das bis dahin insgesamt ${mine}, wenn Sie nicht vorher bei Whop kündigen.` : `With ${ref.en} that comes to ${mine} in total until then, unless you cancel at Whop earlier.`)
      : (de ? `Die ${opened.name} ist eine Einmalzahlung von ${mine}, ohne Verlängerung.` : `The ${opened.name} is a one-time payment of ${mine}, with no renewal.`);
    fitLines.push(`${away} ${total}`);
    if (fit.cheaperTier && fit.cheaperTotalCents !== null) {
      const other = planFacts(fit.cheaperTier, lang);
      const otherRef = planRef(other.name);
      const otherTotal = billingAmount(fit.cheaperTotalCents, lang);
      const otherRenews = CADENCE_DAYS[fit.cheaperTier] !== null;
      fitLines.push(otherRenews
        ? (de ? `Der Tarif ${other.name} deckt denselben Zeitraum für insgesamt ${otherTotal} ab, wenn Sie nicht vorher bei Whop kündigen.` : `${otherRef.en[0].toUpperCase()}${otherRef.en.slice(1)} covers the same period for ${otherTotal} in total, unless you cancel at Whop earlier.`)
        : (de ? `Die ${other.name} deckt denselben Zeitraum als Einmalzahlung von ${otherTotal} ab, ohne Verlängerung.` : `The ${other.name} covers the same period as a one-time payment of ${otherTotal}, with no renewal.`));
      cheaper = de ? `Stattdessen ${otherRef.acc} wählen` : `Choose ${otherRef.en} instead`;
    }
  }
  return {
    title: de ? "Zurück zu Ihrem Checkout" : "Back to your checkout",
    body: de
      ? `Sie hatten ${ref.acc} (${opened.price}) geöffnet, die Zahlung wurde aber nicht abgeschlossen. Sie können dort weitermachen.`
      : `You opened ${ref.en} (${opened.price}) but the payment was not completed. You can carry on from there.`,
    fit: fitLines,
    primary: de ? `Mit ${ref.dat} fortfahren` : `Continue with ${ref.en}`,
    cheaper,
    help: de ? "Probleme bei der Zahlung? Schreiben Sie uns, wir helfen Ihnen gerne weiter:" : "Trouble with the payment? Write to us and we will gladly help:",
    helpLink: BILLING_SUPPORT_EMAIL,
    helpMailto: `mailto:${BILLING_SUPPORT_EMAIL}?subject=${encodeURIComponent(de ? "Hilfe zur Zahlung" : "Payment help")}`,
    dismiss: de ? "Später ausblenden" : "Hide for now",
  };
}
