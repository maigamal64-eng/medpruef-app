/**
 * KP-DE: German Kenntnisprüfung case practice (a-de-kp-engine-1112, spec
 * docs/specs/de-kenntnispruefung/FEATURE-SPEC.md). The data key lives here and
 * only here: it is never added to EXAM_SOURCES, free-access.ts, questions or
 * the Austrian pickers. Importable only from src/app/kenntnispruefung-deutschland,
 * src/app/api/de-kp and src/components/de-kp (boundary test, spec 6.4).
 */
export const DE_KP_EXAM_KEY = "de_kenntnispruefung";

export const DE_KP_SUBJECTS = ["innere", "chirurgie", "notfall"] as const;
export type DeKpSubject = (typeof DE_KP_SUBJECTS)[number];

export const DE_KP_STEPS = ["anamnese", "differentials", "bericht", "oral", "done"] as const;
export type DeKpStep = (typeof DE_KP_STEPS)[number];

export const DE_KP_SOURCES = ["de_kp_landing", "de_kp_hub"] as const;
export type DeKpSource = (typeof DE_KP_SOURCES)[number];

/** Server flag. Absent or anything but the literal "true" is OFF. */
export function deKpEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DE_KP_ENABLED === "true";
}
