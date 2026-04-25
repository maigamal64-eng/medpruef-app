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
}

export interface PaywallCopyArgs {
  lang: "de" | "en";
  /** Optional exam label for nuance — e.g. "Pharmakologie". Reserved for
   * future per-exam tuning; currently unused but kept in the signature so
   * callers don't have to churn when we do wire it. */
  examLabel?: string;
}

export function getPaywallCopy({ lang }: PaywallCopyArgs): PaywallCopy {
  const de = lang === "de";

  return {
    title: de
      ? "Freie 150 Fragen geschafft — weiter mit Pro"
      : "Free 150 done — continue with Pro",

    description: de
      ? "Hol dir Zugriff auf den kompletten Fragenpool (10.992 Fragen) plus Wiederholungsplan, Mock-Prüfung und die Pass-Garantie."
      : "Unlock the full 10,992-question bank, spaced repetition, mock exam, and the pass-or-study-free guarantee.",

    bullets: de
      ? [
          "Voller Zugriff auf alle 10.992 Fragen über alle 3 Prüfungstypen",
          "Pass first try — oder lerne kostenlos weiter bis zum Bestehen",
          "Wiederholungsplan, Mock-Prüfung und Leistungs-Dashboard",
          "7-Tage-Geld-zurück-Garantie — keine Fragen",
        ]
      : [
          "Full access to all 10,992 questions across 3 exam types",
          "Pass first try — or study free until you do",
          "Spaced repetition, mock exam, and performance dashboard",
          "7-day money-back guarantee — no questions asked",
        ],

    primaryCta: de ? "Pläne ansehen" : "See plans",
    secondaryCta: de ? "Später" : "Later",

    reassurance: de
      ? "Keine automatische Verlängerung ohne Ankündigung. Kündigung mit 1-Klick."
      : "No silent auto-renewal. Cancel with one click.",

    milestoneIntro: de
      ? "Du hast die 150 kostenlosen Fragen für diese Prüfung durchgearbeitet."
      : "You finished the 150 free questions for this exam.",

    milestoneFollowup: de
      ? "Das ist ein Meilenstein — jetzt kommt der wichtige Teil."
      : "That's a milestone — now comes the meaningful part.",
  };
}
