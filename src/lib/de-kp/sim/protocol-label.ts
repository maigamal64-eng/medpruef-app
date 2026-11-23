/**
 * Learner-facing marking of a case that was drafted with a found exam protocol as one source
 * ([name], 16 Nov 2026, D-7 option 2: "nach Prüfungsprotokoll", with Land and exam date). Every surface that shows
 * such a case (picker, runner header, result, history) must show this line. The case itself is always drafted
 * fresh and reviewed, so the line never says real, recalled or the exam. Copy flagged for Lektor.
 */
import type { SimProvenance } from "@/lib/sim";

export const PROTOCOL_LABEL_DE = "Nach Prüfungsprotokoll";

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** "2026-10" or "2026-10-14" -> "Oktober 2026" / "14. Oktober 2026"; anything else -> null. */
export function protocolDateDe(examDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.exec(examDate ?? "");
  if (!m) return null;
  const month = MONTHS_DE[Number(m[2]) - 1];
  return m[3] ? `${Number(m[3])}. ${month} ${m[1]}` : `${month} ${m[1]}`;
}

/** Null for a case drafted from open references only; otherwise "Nach Prüfungsprotokoll, Bayern, Oktober 2026" (Land and date only when known). */
export function protocolLabelDe(p: SimProvenance): string | null {
  if (p.kind !== "protocol_informed") return null;
  return [PROTOCOL_LABEL_DE, p.land?.trim() || null, protocolDateDe(p.examDate)].filter(Boolean).join(", ");
}
