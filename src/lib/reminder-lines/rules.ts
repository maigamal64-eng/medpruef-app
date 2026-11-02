/**
 * Where the A3 reminder lines may show (a-growth-lines-1102). The reminder
 * opt-in covers the Vienna SIP bank and the Rezeptierkunde and
 * Gerichtsmedizin bank only, so never a page or plan about the
 * Stichprobentest alone. Pure.
 */
import type { OfficialExamKey } from "@/lib/exam-dates";

const REMINDER_EXAMS: ReadonlySet<string> = new Set(["sip4a", "sip5a", "rezeptierkunde", "gerichtsmedizin"]);

/** An answer page shows the line when any of its exams is a SIP or Rez/GM exam. */
export function answerPageHasReminderLine(exams: readonly OfficialExamKey[]): boolean {
  return exams.some((e) => REMINDER_EXAMS.has(e));
}

/** A /lernplan plan shows the line for the Vienna SIP bank and the pharma bank. */
export function lernplanHasReminderLine(bank: string | null | undefined): boolean {
  return bank === "kenntnispruefung" || bank === "pharma";
}

/** A signed-in reader gets the Settings CTA only while reminders can be turned on for the account's bank. */
export function signedInCanTurnOn(view: { state: string; email: string | null; exam: string | null } | null): boolean {
  return !!view && view.state === "off" && !!view.email && (view.exam === "kenntnispruefung" || view.exam === "pharma");
}
