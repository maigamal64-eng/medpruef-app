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
 *   - review time: no hour figure until it is measured; the spec's fallback
 *     "in der Regel innerhalb weniger Werktage" is used (UX-PUB-23, PUB-28)
 *   - "mit offener Anmeldung" is [name]'s approved policy (pick-access-dates A);
 *     approvals are manual with a per-claim override, and the code default
 *     is suggestNextExpiresAt in exam-dates.ts (a27, same rule)
 *   - examples (TR-20, pick-puyp-outcomes A): a SIP block under the pass mark,
 *     and the Stichprobentest, which is one attempt, is not passed or failed
 *     in the usual sense and only decides which further exams are prescribed;
 *     the learner claims for the prescribed exam they did not pass
 *   - an access extension, not a cash refund; the purchase refund rule is
 *     separate (pick-refund-route A: email, refunded through Whop)
 * Formal Sie, no em dashes.
 */
import { TIERS } from "./content-truth";
import { billingAmount, type BillingLang } from "./billing-copy";
import { PUYP_COMPLETION_THRESHOLD_PCT, PUYP_MAX_EXTENSIONS } from "./puyp";

export const PUYP_BUFFER_DAYS = 14;

export interface PuypRow { label: string; value: string }

const pct = PUYP_COMPLETION_THRESHOLD_PCT;
const max = PUYP_MAX_EXTENSIONS;
const days = PUYP_BUFFER_DAYS;

/**
 * Copy by language. A record, not inline ternaries, so a reviewed language
 * is one more key (LX-19). Guarantee conditions in further languages need a
 * legal-quality review first (UX-ACC-18).
 */
const COPY: Record<BillingLang, {
  scope: string;
  conditions: PuypRow[];
  examples: string[];
  examplesHeading: string;
  notRefund: string;
  definition: (cohort: string, rows: string, notRefund: string) => string;
}> = {
  de: {
    scope: "Die Garantie gilt nur für die Prüfungs-Kohorte.",
    conditions: [
      { label: "Voraussetzung", value: `Sie haben mindestens ${pct} % der Fragenbank Ihrer Prüfung bearbeitet und die Prüfung nicht bestanden.` },
      { label: "Nachweis", value: "Sie laden Ihr offizielles Prüfungsergebnis hoch. Wir prüfen den Nachweis in der Regel innerhalb weniger Werktage." },
      { label: "Verlängerung", value: `Ihr Zugang läuft kostenlos bis zum nächsten offiziellen Termin Ihrer Prüfung mit offener Anmeldung, plus ${days} Tage. Höchstens ${max === 2 ? "zweimal" : `${max}-mal`}.` },
    ],
    examples: [
      `SIP-Block: Sie liegen in einem Block von SIP4a oder SIP5a unter der Bestehensgrenze. Sie laden das offizielle Ergebnis hoch und wählen die Prüfung SIP4a / SIP5a Wien. Ihr Zugang läuft bis zum nächsten SIP-Termin, für den die Anmeldung noch offen ist, plus ${days} Tage, damit Sie den Block oder die Prüfung wiederholen können.`,
      `Stichprobentest: Den Stichprobentest legen Sie nur einmal ab. Er kennt kein Bestehen oder Nichtbestehen im üblichen Sinn, sein Ergebnis legt fest, welche weiteren Prüfungen Ihnen vorgeschrieben werden. Bestehen Sie danach eine dieser Prüfungen nicht (zum Beispiel einen SIP-Block oder Rezeptierkunde), laden Sie deren offizielles Ergebnis hoch und wählen diese Prüfung. Ihr Zugang läuft bis zum nächsten Termin dieser Prüfung mit offener Anmeldung plus ${days} Tage.`,
    ],
    examplesHeading: "Zwei Beispiele:",
    notRefund: "Die Garantie verlängert Ihren Zugang, sie ist keine Geldrückerstattung.",
    definition: (cohort, rows, notRefund) => `Die Pass-Until-You-Pass-Garantie gilt nur für die Prüfungs-Kohorte (${cohort} einmalig für 6 Monate). ${rows} ${notRefund}`,
  },
  en: {
    scope: "The guarantee applies to the Exam Cohort only.",
    conditions: [
      { label: "Condition", value: `You have worked through at least ${pct} % of your exam's question bank and did not pass the exam.` },
      { label: "Proof", value: "You upload your official exam result. We usually check it within a few working days." },
      { label: "Extension", value: `Your access runs free until the next official sitting of your exam with open registration, plus ${days} days. At most ${max === 2 ? "twice" : `${max} times`}.` },
    ],
    examples: [
      `SIP block: you score under the pass mark in one block of SIP4a or SIP5a. You upload the official result and choose the exam SIP4a / SIP5a Wien. Your access runs until the next SIP sitting whose registration is still open, plus ${days} days, so you can retake the block or the exam.`,
      `Stichprobentest: you sit the Stichprobentest only once. It is not passed or failed in the usual sense; its result decides which further exams are prescribed for you. If you then do not pass one of those exams (for example an SIP block or Rezeptierkunde), you upload that exam's official result and choose that exam. Your access runs until the next sitting of that exam with open registration, plus ${days} days.`,
    ],
    examplesHeading: "Two examples:",
    notRefund: "The guarantee extends your access; it is not a cash refund.",
    definition: (cohort, rows, notRefund) => `The Pass-Until-You-Pass guarantee applies to the Exam Cohort only (${cohort} once for 6 months). ${rows} ${notRefund}`,
  },
};

/** One-line scope for the pricing hero and any plan card that lacks the guarantee. */
export function puypScopeLine(lang: BillingLang): string {
  return COPY[lang].scope;
}

/** Three key and value rows: condition, proof, extension. */
export function puypConditions(lang: BillingLang): PuypRow[] {
  return COPY[lang].conditions.map((row) => ({ ...row }));
}

/** Worked examples [name] asked for (pick-puyp-outcomes A). */
export function puypExamples(lang: BillingLang): string[] {
  return [...COPY[lang].examples];
}

/** Lead-in line above the worked examples (AGB). */
export function puypExamplesHeading(lang: BillingLang): string {
  return COPY[lang].examplesHeading;
}

/** The guarantee is an extension, never cash; the purchase refund rule stays separate. */
export function puypNotRefund(lang: BillingLang): string {
  return COPY[lang].notRefund;
}

/** One-paragraph definition for FAQ answers, the AGB and JSON-LD. */
export function puypDefinition(lang: BillingLang): string {
  const cohort = billingAmount(TIERS.premium_pass_guaranteed.price_cents, lang);
  const rows = COPY[lang].conditions.map((row) => row.value).join(" ");
  return COPY[lang].definition(cohort, rows, COPY[lang].notRefund);
}
