/**
 * paywall-copy: the one paywall copy for every in-app gate (UX-GLOBAL-19).
 * `getGateCopy` is the only export for copy; the old per-surface
 * getPaywallCopy was removed (F31) so nobody reuses its stale wording.
 * The plan sentences follow the offer switch (pricingV2Enabled, the build
 * mirror, client safe).
 */

import type { Feature } from "./entitlements";
import { billingAmount, v2RenewalLine } from "./billing-copy";
import { gateSentence } from "./entitlement-copy";
import { pricingV2Enabled } from "./pricing-v2/flag";

// ── One gate copy (UX-GLOBAL-19) ────────────────────────────────────
// Every in-app gate opens the same paywall with this copy. The cap counts
// distinct ANSWERED questions (free-access.ts), so the title says
// "beantwortet", with seen and limit from the server.

export type PaywallGateKind = "qbank_limit" | "spaced_repetition" | "wrong_only" | "mock_exam" | "bookmarks" | "history";

export interface GateCopyArgs {
  lang: string;
  gate: PaywallGateKind;
  /** Bank label from getExamLabel; omitted when unknown. */
  bankLabel?: string;
  limit?: number;
  /** The learner's own result, shown as positive context (never shaming). */
  accuracyPct?: number | null;
}

export interface GateCopy {
  title: string;
  result: string | null;
  keep: string;
  primary: string;
  later: string;
  pricingHref: string;
  /** Bridge to the pricing page's exam question; only while the v2 offer is on (F13). */
  fits: string | null;
  /** One-line renewal truth for the offer (UX-ACC-24). */
  renewal: string;
  /** Clearly labelled secondary: the card trial (pick-ux-acc-24 B, plans first). */
  trialLabel: string;
  trialTerms: (days: number, priceAfter: string) => string;
  trialHref: string;
  switchExam: string;
  alreadyPro: string;
  otherAccount: string;
}

const GATE_FEATURE: Record<Exclude<PaywallGateKind, "qbank_limit">, Feature> = {
  spaced_repetition: "spaced_repetition",
  wrong_only: "mistake_review",
  mock_exam: "mock_exam",
  bookmarks: "bookmarks",
  history: "history",
};

const GATE_PARAM: Record<PaywallGateKind, string> = {
  qbank_limit: "qbank_limit",
  spaced_repetition: "spaced_repetition",
  wrong_only: "mistakes",
  mock_exam: "mock_exam",
  bookmarks: "bookmarks",
  history: "history",
};

export function getGateCopy({ lang, gate, bankLabel, limit, accuracyPct }: GateCopyArgs): GateCopy {
  const de = lang === "de";
  const cap = limit && limit > 0 ? limit : 150;
  const v2 = pricingV2Enabled();
  const title = gate === "qbank_limit"
    ? de
      ? `Sie haben die kostenlose Probe in ${bankLabel ?? "dieser Fragenbank"} abgeschlossen: Alle ${cap} Fragen sind beantwortet.`
      : `You have finished the free sample in ${bankLabel ?? "this bank"}: all ${cap} questions are answered.`
    : gateSentence(GATE_FEATURE[gate], lang);
  const result = accuracyPct != null && accuracyPct > 0
    ? de ? `Ihr Ergebnis bisher: ${accuracyPct} % richtig.` : `Your result so far: ${accuracyPct}% correct.`
    : null;
  return {
    title,
    result,
    keep: de ? "Ihr Fortschritt und Ihre Fehlerliste bleiben erhalten." : "Your progress and your mistake list are kept.",
    // ACC-24 option B (plans first) until a pre-charge reminder exists (ACC-55).
    primary: de ? "Tarife ansehen" : "See plans",
    later: de ? "Später" : "Later",
    pricingHref: `/pricing?gate=${GATE_PARAM[gate]}`,
    fits: v2
      ? de
        ? "Auf der Preisseite fragen wir, wann Ihre Prüfung ist, und markieren den passenden Tarif."
        : "On the pricing page we ask when your exam is and mark the plan that fits."
      : null,
    // a-v2-copy-surfaces-1021: one owner for the v2 renewal sentence (billing-copy.ts).
    renewal: v2
      ? v2RenewalLine(de ? "de" : "en")
      : de
        ? "Monatsabo und 3-Monats-Tarif verlängern sich automatisch, bis Sie kündigen. Die Prüfungs-Kohorte ist eine Einmalzahlung."
        : "The monthly and 3-month plans renew automatically until you cancel. The Exam Cohort is a one-time payment.",
    trialLabel: de ? "Pro-Test mit Karte" : "Pro trial with card",
    trialTerms: (days, priceAfter) => de
      ? `${days} Tage Pro. Karte nötig, heute ${billingAmount(0, "de")}, danach ${priceAfter} pro Monat, wenn Sie nicht vorher kündigen.`
      : `${days} days of Pro. Card required, ${billingAmount(0, "en")} today, then ${priceAfter} per month unless you cancel before.`,
    trialHref: "/pricing?action=trial&intent=trial#pro-test",
    switchExam: de ? "Andere Prüfung üben" : "Practise another exam",
    alreadyPro: de ? "Schon Pro? Melden Sie sich mit dem Konto an, mit dem Sie bezahlt haben." : "Already Pro? Sign in with the account you paid with.",
    otherAccount: de ? "Anderes Konto verwenden" : "Use another account",
  };
}
