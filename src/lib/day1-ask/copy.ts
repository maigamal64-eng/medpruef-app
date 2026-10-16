/**
 * The one onboarding mail of the day-1 sitting ask (a-day1-sitting-ask).
 * Formal Sie (German), no dates anywhere (SoT 5.4 learner-mail carve-out:
 * no date, no price, no offer), no em dashes, no medical line. German for
 * German or unknown accounts, English only for en accounts (rulebook v1).
 *
 * Lektor review: reports/track-b-2026-10-11/handover/a-day1-sitting-ask/
 * (lektor.md). Change a string only with a new Lektor APPROVE.
 */
export type Day1Lang = "de" | "en";

/** Rulebook v1: English only for en accounts; German Sie for every other language and for unknown. */
export function day1Lang(languageCode: string | null | undefined): Day1Lang {
  return (languageCode ?? "").trim().toLowerCase().startsWith("en") ? "en" : "de";
}

export interface Day1Copy {
  subject: string;
  heading: string;
  lead: string;
  pickCta: string;
  starterLead: string;
  starterCta: string;
  why: string;
  stop: string;
  signoff: string;
}

export const DAY1_COPY: Record<Day1Lang, Day1Copy> = {
  de: {
    subject: "MedPrüf: Auf welchen Prüfungstermin bereiten Sie sich vor?",
    heading: "Welcher Prüfungstermin ist Ihrer?",
    lead: "Wenn Sie uns Ihren Prüfungstermin nennen, richten wir Ihren Lernplan darauf aus. Das geht in wenigen Sekunden, und Sie müssen sich dafür nicht anmelden.",
    pickCta: "Termin auswählen",
    starterLead: "Noch unentschieden? Dann beginnen Sie mit zehn Fragen.",
    starterCta: "Zehn Fragen üben",
    why: "Diese Nachricht schicken wir Ihnen einmalig nach Ihrer Registrierung bei MedPrüf. Es folgt keine Serie.",
    stop: "Antworten Sie mit Stopp, dann schreibe ich Ihnen nicht mehr.",
    signoff: "Viele Grüße, [name]",
  },
  en: {
    subject: "MedPrüf: which exam sitting are you preparing for?",
    heading: "Which exam sitting is yours?",
    lead: "If you tell us your sitting, we set your study plan to it. It takes a few seconds, and you do not need to sign in for this.",
    pickCta: "Choose your sitting",
    starterLead: "Not sure yet? Start with ten questions.",
    starterCta: "Practice ten questions",
    why: "We send you this message once, after you register at MedPrüf. No series follows.",
    stop: "Reply with Stop and I will not email you again. Auf Deutsch: Antworten Sie mit Stopp, dann schreibe ich Ihnen nicht mehr.",
    signoff: "Best, [name]",
  },
};
