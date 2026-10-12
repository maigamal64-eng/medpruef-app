import {
  OFFICIAL_SITTINGS, OFFICIAL_KEYS_BY_BANK, asPuypExamType,
  daysUntilViennaDate, hasOfficialWindowStarted, isOfficialWindowOpen,
  viennaStamp, type OfficialSitting,
} from "@/lib/exam-dates";

export const REMINDER_OFFSETS = [14, 7, 3, 1] as const;

// The base calendar lacks R3's window_unconfirmed field. Keep this explicit
// hold until the source corrects its typo; never infer a registration window.
export const UNCONFIRMED_WINDOWS = [
  { exam_key: "sip4a", date: "2027-03-10", source_url: OFFICIAL_SITTINGS.find(s => s.exam_key === "sip4a")!.source_url, read_on: "2026-10-11" },
  { exam_key: "sip5a", date: "2027-03-10", source_url: OFFICIAL_SITTINGS.find(s => s.exam_key === "sip5a")!.source_url, read_on: "2026-10-11" },
] as const;

export function reminderSchedule(exam: string, now: Date, sittings = OFFICIAL_SITTINGS) {
  const bank = asPuypExamType(exam);
  const keys = exam === "all" ? Object.values(OFFICIAL_KEYS_BY_BANK).flat() : bank ? OFFICIAL_KEYS_BY_BANK[bank] : [];
  return sittings.flatMap(sitting => {
    const unconfirmed = (sitting as OfficialSitting & { window_unconfirmed?: boolean }).window_unconfirmed;
    if (unconfirmed || UNCONFIRMED_WINDOWS.some(w => w.exam_key === sitting.exam_key && w.date === sitting.date)) return [];
    // Signup has no filing university. Do not silently choose an STP deadline.
    if (sitting.deadline_type !== "registration" || sitting.exam_key === "stichprobentest") return [];
    if (!keys.includes(sitting.exam_key) || !sitting.registration_opens || !sitting.registration_closes) return [];
    if ((sitting.date_end ?? sitting.date) < viennaStamp(now).slice(0, 10)) return [];
    if (!hasOfficialWindowStarted(sitting, now) || !isOfficialWindowOpen(sitting, now)) return [];
    const offset = daysUntilViennaDate(sitting.registration_closes, now);
    if (!REMINDER_OFFSETS.some(n => n === offset)) return [];
    // A source wording/deadline correction must not reset a sent offset.
    const sittingKey = [sitting.exam_key, sitting.date, sitting.deadline_type, sitting.filing_university ?? "all"].join(":");
    return [{ sitting, sittingKey, offset }];
  });
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
