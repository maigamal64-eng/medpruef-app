/**
 * paywall-copy — single source of truth for 150-question-cap paywall
 * copy across the app.
 *
 * Why this file exists (post-soft-launch §1.4.7):
 *
 * The flashcards full-bleed upgrade screen and the `PaywallUpgradeModal`
 * had diverged copy — both present the same offer (Pro for €114 via the
 * June 26 Cohort) but the bullets, tone, and CTA labels drifted during
 * parallel edits. A user who hit the paywall on flashcards then again
 * in quiz saw two different pitches in the same session, which reads
 * as "this team can't even keep their pricing message straight."
 *
 * Rules for consumers:
 *
 *   1. Import `getPaywallCopy({ lang, examLabel? })` — do NOT hand-
 *      roll paywall copy inline. Update this module if a change is
 *      needed; every surface picks it up for free.
 *   2. The `bullets[]` order is load-bearing — PUYP first (it's the
 *      headline promise), then the full-bank unlock, then the tooling
 *      (spaced repetition, mock exam), then the reassurance (money-
 *      back guarantee). Don't reorder per-surface.
 *   3. `primaryCta` / `secondaryCta` labels are consumed verbatim.
 *      Consumers are responsible for wiring href + utm tagging.
 *
 * Last updated: 2026-04-23 (post-soft-launch sprint §1.4.7).
 */

import type { Feature } from "./entitlements";
import { billingAmount } from "./billing-copy";
import { gateSentence } from "./entitlement-copy";

export interface PaywallCopy {
  title: string;
  description: string;
  bullets: string[];
  primaryCta: string;
  secondaryCta: string;
  /** Short trust line — "no silent renewal" kind of thing. */
  reassurance: string;
  /** Short intro sentence for the "you just finished the free 150" moment. */
  milestoneIntro: string;
  /** Follow-on sentence: "now comes the meaningful part". */
  milestoneFollowup: string;
  /**
   * One factual, low-key line clarifying that a second free account does
   * NOT unlock more questions (added 2026-07-27, after a paying user hit
   * the cap on a free second account instead of signing back into their
   * paid one — see the Hafez/dr.ataya case). Render as small muted text,
   * never as a competing CTA.
   */
  secondAccountNote: string;
}

export interface PaywallCopyArgs {
  lang: "de" | "en";
  /** Optional exam label for nuance — e.g. "Pharmakologie". Reserved for
   * future per-exam tuning; currently unused but kept in the signature so
   * callers don't have to churn when we do wire it. */
  examLabel?: string;
  /**
   * Per-user stats injected into the milestone intro to surface the
   * endowment effect (review-2026-04-25-B4). When provided, the intro
   * reads "Du hast 47 Fragen beantwortet · 71 % richtig" instead of the
   * generic milestone line. Endowment effect (Thaler 1980): users
   * value work-in-progress ~2× more than identical work they could
   * have. The numbers are the user's own labour, served back to them
   * at peak commitment cost. Source: conversion-psych audit critical #2.
   *
   * All fields optional — when undefined, the milestone intro falls
   * back to the original copy. Pass an explicit `0` to suppress that
   * stat from the rendered string.
   */
  stats?: {
    answered?: number;
    correct?: number;
    accuracyPct?: number;
    streakDays?: number;
    topicsTouched?: number;
  };
}

export function getPaywallCopy({ lang, stats }: PaywallCopyArgs): PaywallCopy {
  const de = lang === "de";

  // Build a stats line from whatever fields the caller passed. Skips
  // any undefined or zero entry. If nothing usable, returns null and
  // the milestone intro falls back to the generic copy.
  const buildStatsLine = (): string | null => {
    if (!stats) return null;
    const parts: string[] = [];
    if (stats.answered != null && stats.answered > 0) {
      parts.push(de ? `${stats.answered} Fragen beantwortet` : `${stats.answered} questions answered`);
    }
    if (stats.accuracyPct != null && stats.accuracyPct > 0) {
      parts.push(de ? `${stats.accuracyPct} % richtig` : `${stats.accuracyPct}% correct`);
    }
    if (stats.topicsTouched != null && stats.topicsTouched > 0) {
      parts.push(de ? `${stats.topicsTouched} Themen` : `${stats.topicsTouched} topics`);
    }
    if (stats.streakDays != null && stats.streakDays > 0) {
      parts.push(de ? `${stats.streakDays}-Tage-Streak` : `${stats.streakDays}-day streak`);
    }
    if (parts.length === 0) return null;
    return parts.join(" · ");
  };
  const statsLine = buildStatsLine();

  return {
    title: de
      ? "Freie 150 Fragen geschafft: weiter mit Pro"
      : "Free 150 done: continue with Pro",

    // UX-GLOBAL-08/19 (a12): no pass promise and no second guarantee
    // definition here; the guarantee terms live once on /pricing.
    description: de
      ? "Mit Pro üben Sie mit dem vollen Fragenpool (über 10.000 Fragen), der Wiederholungsplanung und der Prüfungssimulation."
      : "With Pro you practise with the full bank (10,000+ questions), review scheduling and the mock exam.",

    bullets: de
      ? [
          "Voller Zugriff auf alle Fragen in allen drei Fragenbanken",
          "Wiederholungsplanung, Fehlerwiederholung und Prüfungssimulation",
          "Die Bedingungen der Pass-Until-You-Pass-Garantie stehen auf der Preisseite",
        ]
      : [
          "Full access to every question in all three banks",
          "Review scheduling, mistake review and the mock exam",
          "The Pass-Until-You-Pass guarantee terms are on the pricing page",
        ],

    primaryCta: de ? "Pläne ansehen" : "See plans",
    secondaryCta: de ? "Später" : "Later",

    reassurance: de
      ? "Monats- und 3-Monats-Tarif verlängern sich bis zur Kündigung, bei Whop verwaltbar. Die Kohorte ist eine Einmalzahlung."
      : "Monthly and 3-month plans renew until you cancel, at Whop. The Cohort is a one-time payment.",

    milestoneIntro: statsLine
      ? de
        ? `Geschafft: ${statsLine}.`
        : `You've made it: ${statsLine}.`
      : de
        ? "Sie haben die 150 kostenlosen Fragen dieser Fragenbank beantwortet."
        : "You finished the 150 free questions for this exam.",

    milestoneFollowup: statsLine
      ? de
        ? "Das ist Ihre Arbeit. Mit Pro behalten Sie alles und schalten die restlichen Fragen frei."
        : "That's your own work. With Pro you keep all of it and unlock the rest."
      : de
        ? "Das ist ein Meilenstein: jetzt kommt der wichtige Teil."
        : "That's a milestone: now comes the meaningful part.",

    secondAccountNote: de
      ? "Schon Pro? Melden Sie sich mit dem Konto an, mit dem Sie bezahlt haben."
      : "Already Pro? Sign in with the account you paid with.",
  };
}

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
  const title = gate === "qbank_limit"
    ? de
      ? bankLabel ? `Sie haben alle ${cap} kostenlosen Fragen in ${bankLabel} beantwortet.` : `Sie haben alle ${cap} kostenlosen Fragen dieser Fragenbank beantwortet.`
      : bankLabel ? `You have answered all ${cap} free questions in ${bankLabel}.` : `You have answered all ${cap} free questions in this bank.`
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
    renewal: de
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
