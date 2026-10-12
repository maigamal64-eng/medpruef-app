/**
 * Pass-Until-You-Pass, defined once (UX-PUB-23). Pricing, FAQ, AGB and any
 * exam page render the guarantee from here, so the threshold, the extension
 * length and the review time cannot drift between surfaces again.
 *
 * Facts:
 *   - Exam Cohort only (PUYP_ELIGIBLE_TIERS, content-truth.ts)
 *   - at least 70 % of the bank worked (PUYP_COMPLETION_THRESHOLD_PCT, puyp.ts)
 *   - at most two extensions (PUYP_MAX_EXTENSIONS, puyp.ts)
 *   - each extension runs to the next official sitting of the learner's exam
 *     with open registration, plus 14 days ([name], pick-puyp-outcomes A and
 *     pick-access-dates A, 2026-10-11; existing access is never shortened)
 *   - review time: no hour promise until it is measured (UX-PUB-23, PUB-28)
 *   - an access extension, not a cash refund; the purchase refund rule is
 *     separate (pick-refund-route A: email, refunded through Whop)
 * Formal Sie, no em dashes.
 */
import { TIERS } from "./content-truth";
import { billingAmount, type BillingLang } from "./billing-copy";
import { PUYP_COMPLETION_THRESHOLD_PCT, PUYP_MAX_EXTENSIONS } from "./puyp";

export const PUYP_BUFFER_DAYS = 14;

export interface PuypRow { label: string; value: string }

/** One-line scope for the pricing hero and any plan card that lacks the guarantee. */
export function puypScopeLine(lang: BillingLang): string {
  return lang === "de" ? "Die Garantie gilt nur für die Prüfungs-Kohorte." : "The guarantee applies to the Exam Cohort only.";
}

/** Three key and value rows: condition, proof, extension. */
export function puypConditions(lang: BillingLang): PuypRow[] {
  const pct = PUYP_COMPLETION_THRESHOLD_PCT;
  const max = PUYP_MAX_EXTENSIONS;
  return lang === "de"
    ? [
        { label: "Voraussetzung", value: `Sie haben mindestens ${pct} % der Fragenbank Ihrer Prüfung bearbeitet und die Prüfung nicht bestanden.` },
        { label: "Nachweis", value: "Sie laden Ihr offizielles Prüfungsergebnis hoch. Wir prüfen den Nachweis in der Regel innerhalb weniger Werktage." },
        { label: "Verlängerung", value: `Ihr Zugang läuft kostenlos bis zum nächsten offiziellen Termin Ihrer Prüfung mit offener Anmeldung, plus ${PUYP_BUFFER_DAYS} Tage. Höchstens ${max === 2 ? "zweimal" : `${max}-mal`}.` },
      ]
    : [
        { label: "Condition", value: `You have worked through at least ${pct} % of your exam's question bank and did not pass the exam.` },
        { label: "Proof", value: "You upload your official exam result. We usually check it within a few working days." },
        { label: "Extension", value: `Your access runs free until the next official sitting of your exam with open registration, plus ${PUYP_BUFFER_DAYS} days. At most ${max === 2 ? "twice" : `${max} times`}.` },
      ];
}

/** Worked examples [name] asked for (pick-puyp-outcomes A). */
export function puypExamples(lang: BillingLang): string[] {
  return lang === "de"
    ? [
        `Wien: Sie bestehen einen SIP-Block nicht. Ihr Zugang läuft bis zum nächsten SIP-Termin mit offener Anmeldung plus ${PUYP_BUFFER_DAYS} Tage, damit Sie den Block wiederholen können.`,
        `Stichprobentest: Nach dem Stichprobentest werden Ihnen weitere Prüfungen vorgeschrieben und Sie bestehen eine davon nicht. Ihr Zugang läuft bis zum nächsten Termin dieser Prüfung plus ${PUYP_BUFFER_DAYS} Tage.`,
      ]
    : [
        `Vienna: you do not pass an SIP block. Your access runs until the next SIP sitting with open registration plus ${PUYP_BUFFER_DAYS} days, so you can retake the block.`,
        `Stichprobentest: after the Stichprobentest further exams are required of you and you do not pass one of them. Your access runs until the next sitting of that exam plus ${PUYP_BUFFER_DAYS} days.`,
      ];
}

/** The guarantee is an extension, never cash; the purchase refund rule stays separate. */
export function puypNotRefund(lang: BillingLang): string {
  return lang === "de"
    ? "Die Garantie verlängert Ihren Zugang, sie ist keine Geldrückerstattung."
    : "The guarantee extends your access; it is not a cash refund.";
}

/** One-paragraph definition for FAQ answers, the AGB and JSON-LD. */
export function puypDefinition(lang: BillingLang): string {
  const cohort = billingAmount(TIERS.premium_pass_guaranteed.price_cents, lang);
  const rows = puypConditions(lang).map((row) => row.value).join(" ");
  return lang === "de"
    ? `Die Pass-Until-You-Pass-Garantie gilt nur für die Prüfungs-Kohorte (${cohort} einmalig für 6 Monate). ${rows} ${puypNotRefund(lang)}`
    : `The Pass-Until-You-Pass guarantee applies to the Exam Cohort only (${cohort} once for 6 months). ${rows} ${puypNotRefund(lang)}`;
}
