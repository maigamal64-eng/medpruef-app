/**
 * One list of report reasons for every report entry point (TR-09, UX-PRA-35):
 * wrong key, unclear, outdated and image missing are always offered. The
 * server stores the value as free text (src/lib/admin/suggestion-edit.ts).
 */
export const REPORT_REASONS = [
  { value: "incorrect_answer", de: "Falsche Antwort", en: "Wrong answer" },
  { value: "unclear", de: "Unklar", en: "Unclear" },
  { value: "outdated", de: "Veraltet", en: "Outdated" },
  { value: "missing_image", de: "Bild fehlt", en: "Image missing" },
  { value: "typo", de: "Tippfehler", en: "Typo" },
  { value: "missing_explanation", de: "Erklärung fehlt", en: "Missing explanation" },
  { value: "ai_explanation_wrong", de: "KI-Erklärung falsch", en: "AI explanation wrong" },
  { value: "malformed", de: "Fehlerhaft", en: "Malformed" },
  { value: "duplicate", de: "Duplikat", en: "Duplicate" },
  { value: "wrong_topic", de: "Falsches Thema", en: "Wrong topic" },
  { value: "other", de: "Sonstiges", en: "Other" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];
