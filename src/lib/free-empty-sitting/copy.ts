/**
 * Copy of the A1 lines on the free empty state (growth pass 2 Nov 2026).
 * Source: reports/growth-weekly/2026-11-02/approved/in-app-lines.json
 * (sha256 315a2b1a8ae37e06d8afd6b396250d70d9e8eb72362c51dc33bf3cb998935143,
 * Lektor APPROVE round 2). Byte-exact: change a string only with a new Lektor
 * APPROVE. {SITTING_LABEL} and {FIT_PLAN_LINE} are filled by code; no date,
 * price or plan name is typed here. German and English only; any other
 * language reads English.
 */
export type FreeEmptyLang = "de" | "en";

export interface FreeEmptyLine {
  body: string;
  cta: string;
}

export const A1_SITTING_LINE: Record<FreeEmptyLang, FreeEmptyLine> = {
  de: {
    body: "Ihr Termin: {SITTING_LABEL}. Mit Pro üben Sie alle Fragen dieses Fachgebiets und die Prüfungssimulation mit Zeitlimit. {FIT_PLAN_LINE}",
    cta: "Tarif bis zu Ihrem Termin ansehen",
  },
  en: {
    body: "Your sitting: {SITTING_LABEL}. With Pro you practise every question in this subject and the timed exam simulation. {FIT_PLAN_LINE}",
    cta: "See the plan up to your sitting",
  },
};

export const A1_ASK_LINE: Record<FreeEmptyLang, FreeEmptyLine> = {
  de: {
    body: "Wann ist Ihre Prüfung? Tragen Sie Ihren Termin ein, dann zeigen wir Ihnen den Tarif, der bis dahin reicht.",
    cta: "Termin eintragen",
  },
  en: {
    body: "When is your exam? Add your sitting and we show you the plan that covers you up to it.",
    cta: "Add your sitting",
  },
};

export function freeEmptyLang(lang: string | null | undefined): FreeEmptyLang {
  if (lang === "de") return "de";
  return "en";
}
