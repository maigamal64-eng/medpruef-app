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

    description: de
      ? "Hol dir Zugriff auf den kompletten Fragenpool (über 10.000 Fragen) plus Wiederholungsplan, Mock-Prüfung und die Pass-Garantie."
      : "Unlock the full 10,000+-question bank, spaced repetition, mock exam, and the pass-or-study-free guarantee.",

    bullets: de
      ? [
          "Voller Zugriff auf über 10.000 Fragen in allen 3 Prüfungstypen",
          "Pass first try, oder lerne kostenlos weiter bis zum Bestehen",
          "Wiederholungsplan, Mock-Prüfung und Leistungs-Dashboard",
          "7-Tage-Geld-zurück-Garantie, keine Fragen",
        ]
      : [
          "Full access to all 10,000+ questions across 3 exam types",
          "Pass first try, or study free until you do",
          "Spaced repetition, mock exam, and performance dashboard",
          "7-day money-back guarantee, no questions asked",
        ],

    primaryCta: de ? "Pläne ansehen" : "See plans",
    secondaryCta: de ? "Später" : "Later",

    reassurance: de
      ? "Monats- und 3-Monats-Tarif verlängern sich bis zur Kündigung, bei Whop verwaltbar. Die Kohorte ist eine Einmalzahlung."
      : "Monthly and 3-month plans renew until you cancel, at Whop. The Cohort is a one-time payment.",

    milestoneIntro: statsLine
      ? de
        ? `Du hast es geschafft: ${statsLine}.`
        : `You've made it: ${statsLine}.`
      : de
        ? "Du hast die 150 kostenlosen Fragen für diese Prüfung durchgearbeitet."
        : "You finished the 150 free questions for this exam.",

    milestoneFollowup: statsLine
      ? de
        ? "Das ist deine Arbeit. Mit Pro behältst du alles und schaltest die restlichen Fragen frei."
        : "That's your own work. With Pro you keep all of it and unlock the rest."
      : de
        ? "Das ist ein Meilenstein: jetzt kommt der wichtige Teil."
        : "That's a milestone: now comes the meaningful part.",

    secondAccountNote: de
      ? "Hinweis: Ein neues Konto schaltet keine weiteren Fragen frei. Die kostenlosen 150 Fragen pro Prüfung sind bei jedem Konto gleich."
      : "Heads up: a new account will not unlock more questions. The free 150 per exam are the same for every account.",
  };
}
