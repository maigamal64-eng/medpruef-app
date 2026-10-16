import { OFFICIAL_SITTINGS, viennaStamp } from "@/lib/exam-dates";
import { optInDeadlineSchedule } from "@/lib/journey/moments";

/**
 * Before a-journey-engine the sender mailed T-14/7/3/1. The approved rule
 * (growth plan LP5, decision d5-flags) is at most two dated mails per
 * deadline to confirmed opt-ins, the first no earlier than 2 Dec 2026, the
 * second two days before the close: optInDeadlineSchedule owns it.
 */
export const REMINDER_OFFSETS = [14, 7, 3, 1] as const;

// The base calendar lacks R3's window_unconfirmed field. Keep this explicit
// hold until the source corrects its typo; never infer a registration window.
export const UNCONFIRMED_WINDOWS = [
  { exam_key: "sip4a", date: "2027-03-10", source_url: OFFICIAL_SITTINGS.find(s => s.exam_key === "sip4a")!.source_url, read_on: "2026-10-11" },
  { exam_key: "sip5a", date: "2027-03-10", source_url: OFFICIAL_SITTINGS.find(s => s.exam_key === "sip5a")!.source_url, read_on: "2026-10-11" },
] as const;

/**
 * The deadline mails due today for a subscription's exam (bank key or "all").
 * Registration deadlines only, never the Stichprobentest (signup has no
 * filing university, so no STP deadline is chosen silently), never an
 * unconfirmed window, only while the window is open. `offset` is the Vienna
 * days to the close on the send day; the send ledger keys on it, so a source
 * wording or deadline correction never resets a sent mail (sittingKey has no
 * close date or publisher).
 */
export function reminderSchedule(exam: string, now: Date, sittings = OFFICIAL_SITTINGS) {
  return optInDeadlineSchedule(exam, now, sittings, UNCONFIRMED_WINDOWS);
}

/** a30: the learner chooses the Vienna hour (06..22, default 09, as b19). */
export const STUDY_NUDGE_HOURS = { min: 6, max: 22, fallback: 9 } as const;
export function viennaHour(now: Date): number {
  return Number(viennaStamp(now).slice(11, 13));
}
export function isStudyNudgeHour(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= STUDY_NUDGE_HOURS.min && (value as number) <= STUDY_NUDGE_HOURS.max;
}
export function studyNudgeWindow(now: Date, hour: number = STUDY_NUDGE_HOURS.fallback): boolean {
  return viennaHour(now) === hour;
}
