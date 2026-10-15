// The date lead of every answer page: the exam and its next official sitting,
// computed from OFFICIAL_SITTINGS on each request. Copy never writes a date.
import { OFFICIAL_SITTINGS, getUpcomingOfficialSittings, viennaStamp, type OfficialExamKey, type OfficialSitting } from "@/lib/exam-dates";
import { guidanceWindow, type GuidanceWindow } from "@/lib/guidance/windows";
import type { Bilingual } from "./types";

export interface LeadRow {
  sitting: OfficialSitting;
  state: GuidanceWindow["state"];
  daysRemaining: number | null;
}

export interface LeadSitting {
  label: Bilingual;
  date: string;
  date_end?: string;
  /** One row per publisher; the Stichprobentest has two for the same sitting. */
  rows: LeadRow[];
}

export interface LeadEntry {
  exam: OfficialExamKey;
  /** The next sitting that has not ended yet, or null when none is published. */
  next: LeadSitting | null;
  /** When every window of `next` has closed: the next later sitting whose window is not closed. */
  nextOpen: LeadSitting | null;
}

function groupByDate(rows: readonly OfficialSitting[], now: Date): LeadSitting[] {
  const groups = new Map<string, LeadSitting>();
  for (const sitting of rows) {
    // One sitting per exam and date: every publisher's row joins it, whatever its label.
    const key = `${sitting.exam_key}|${sitting.date}`;
    const window = guidanceWindow(sitting, now);
    const row: LeadRow = { sitting, state: window.state, daysRemaining: window.daysRemaining };
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { label: sitting.learner_label, date: sitting.date, date_end: sitting.date_end, rows: [row] });
  }
  return [...groups.values()];
}

const notClosed = (group: LeadSitting) => group.rows.some((row) => row.state !== "closed");

export function answerLead(
  exams: readonly OfficialExamKey[],
  now: Date = new Date(),
  sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS,
): LeadEntry[] {
  // Vienna's calendar day, as the guidance pages use it.
  const localDay = new Date(`${viennaStamp(now).slice(0, 10)}T12:00:00Z`);
  return exams.map((exam) => {
    const groups = groupByDate(getUpcomingOfficialSittings({ exam, now: localDay }, sittings), now);
    const next = groups[0] ?? null;
    const nextOpen = next && !notClosed(next) ? groups.slice(1).find(notClosed) ?? null : null;
    return { exam, next, nextOpen };
  });
}
