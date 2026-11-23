/**
 * Learner-facing marking of a case that was drafted with a found exam protocol as one source
 * ([name], 16 Nov 2026, D-7 option 2: "nach Prüfungsprotokoll", with Land and exam date). Every surface that shows
 * such a case (picker, runner header, result, history) must show this line. The case itself is always drafted
 * fresh and reviewed, so the line never says real, recalled or the exam. Copy flagged for Lektor.
 */
import type { SimProvenance } from "@/lib/sim";

export const PROTOCOL_LABEL_DE = "Nach Prüfungsprotokoll";

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** "2026-10" or "2026-10-14" -> "Oktober 2026" (month and year only, whatever precision the source holds); anything else -> null. */
export function protocolDateDe(examDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(examDate ?? "");
  if (!m) return null;
  return `${MONTHS_DE[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Null for a case drafted from open references. For a protocol case: "Nach Prüfungsprotokoll, Bayern, Oktober 2026".
 * Null also when Land or date is missing or unreadable: the caller must then hide the case, never show a bare label.
 */
export function protocolLabelDe(p: SimProvenance): string | null {
  if (p.kind !== "protocol_informed") return null;
  const land = p.land?.trim();
  const date = protocolDateDe(p.examDate);
  if (!land || !date) return null;
  return `${PROTOCOL_LABEL_DE}, ${land}, ${date}`;
}
