/**
 * The two Germany sign-in strings and the plan step path, kept in a module of their own
 * (a-dekp-walkfix2-1120): the sign-in and payment-return pages import this file through the
 * bridge in components/de-kp, so their bundles carry only these strings, never the whole
 * Germany copy object. copy.ts re-exports everything here.
 */

/** The sign-in card on the Germany route: a Germany line, never an Austrian exam name. */
export interface DeKpLoginCopy { tagline: string; context: string }

export const DE_KP_LOGIN: { de: DeKpLoginCopy; en: DeKpLoginCopy } = {
  de: {
    tagline: "Fallübungen zur Kenntnisprüfung in Deutschland",
    context: "Ein Fall ist kostenlos, ohne Karte. Ihr Konto speichert Ihren Fortschritt.",
  },
  en: {
    tagline: "Case practice for the Kenntnisprüfung in Germany",
    context: "One case is free, no card needed. Your account saves your progress.",
  },
};

export const PLAN_STEP_PATH = "/kenntnispruefung-deutschland/plaene";

/** The plan step link for a language (same value as planStepHref(lang) in plans.ts). */
export function planStepPath(lang: "de" | "en"): string {
  return lang === "en" ? `${PLAN_STEP_PATH}?lang=en` : PLAN_STEP_PATH;
}
