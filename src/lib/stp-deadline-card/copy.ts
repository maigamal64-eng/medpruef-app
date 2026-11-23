/**
 * Copy of the C1 Home card (growth pass 16 Nov 2026, angle C1).
 * Source: reports/growth-weekly/2026-11-16/approved/in-app-lines.json
 * (sha256 efc8b8338fe2363756c69da614f047145b09f98fe1469ae1acc47d1c26886fa8,
 * Lektor APPROVE round 2). Byte-exact: change a string only with a new Lektor
 * APPROVE. {SITTING_LABEL}, {ROWS} and {FIT_PLAN_LINE} are filled by code; no
 * date, price or plan name is typed here. German and English only; any other
 * language reads English.
 */
export type StpCardLang = "de" | "en";

export const C1_TITLE: Record<StpCardLang, string> = {
  de: "Ihr Termin: {SITTING_LABEL}",
  en: "Your sitting: {SITTING_LABEL}",
};

export const C1_ROWS: Record<StpCardLang, string> = {
  de: "Für diesen Termin gibt es zwei veröffentlichte Fristen: {ROWS}. Bitte bestätigen Sie die Frist bei der Universität, an der Sie Ihren Antrag eingereicht haben.",
  en: "This sitting has two published deadlines: {ROWS}. Please confirm the deadline with the university where you filed your application.",
};

export const C1_ROWS_ONE_LEFT: Record<StpCardLang, string> = {
  de: "Veröffentlichte Frist für diesen Termin: {ROWS}. Bitte bestätigen Sie die Frist bei der Universität, an der Sie Ihren Antrag eingereicht haben.",
  en: "Published deadline for this sitting: {ROWS}. Please confirm the deadline with the university where you filed your application.",
};

/** The plan line is the code-rendered {FIT_PLAN_LINE} alone (sitting-link fitLine); only the CTA is typed. */
export const C1_PLAN_CTA: Record<StpCardLang, string> = {
  de: "Tarif bis zu Ihrem Termin ansehen",
  en: "See the plan up to your sitting",
};

export const C1_ASK: Record<StpCardLang, { body: string; cta: string }> = {
  de: {
    body: "Für welchen Stichprobentest lernen Sie? Wählen Sie Ihren Termin, dann zeigen wir Ihnen die veröffentlichten Fristen und planen bis dahin.",
    cta: "Termin wählen",
  },
  en: {
    body: "Which Stichprobentest are you preparing for? Choose your sitting, and we show you the published deadlines and plan up to it.",
    cta: "Choose your sitting",
  },
};

export function stpCardLang(lang: string | null | undefined): StpCardLang {
  if (lang === "de") return "de";
  return "en";
}
