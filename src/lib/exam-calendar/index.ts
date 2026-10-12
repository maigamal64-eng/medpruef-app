import { OFFICIAL_SITTINGS, viennaToday, type OfficialExamKey, type OfficialSitting } from "@/lib/exam-dates";
import { getSittingFormat, isFormatWindowConfirmed, type FactStatus, type FormatLanguage, type FormatSource, type Localized, type SittingFormat } from "@/lib/exam-formats";
import raw from "./calendar.data.json";
import gi from "@/lib/guidance-data/graz-innsbruck.data.json";
import gm from "@/lib/guidance-data/gerichtsmedizin.data.json";

export const CALENDAR_DATA = raw as { through: string; sources: Record<string, FormatSource>; unconfirmedWindows: { examKey: OfficialExamKey; date: string; sourceId: string; read_on: string }[] };
export interface GuidanceFact { id: string; title: Localized; text: Localized; sourceId: string; status: FactStatus }
export const GI_FACTS = gi.facts as GuidanceFact[];
export const GM_FACTS = gm.facts as GuidanceFact[];
export interface CalendarRow {
  id: string;
  sitting: OfficialSitting;
  format: SittingFormat | undefined;
  windowConfirmed: boolean;
  registrationOpens: string | null;
  registrationCloses: string | null;
  closesAtTime: string | null;
  source: FormatSource;
}
/** Preserve every publisher row; never choose a deadline for a learner. No markup or side effects. */
export function calendarRows(sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): CalendarRow[] {
  return sittings.map((sitting) => {
    const windowConfirmed = isFormatWindowConfirmed(sitting) && !CALENDAR_DATA.unconfirmedWindows.some((x) => x.examKey === sitting.exam_key && x.date === sitting.date);
    const source = Object.values(CALENDAR_DATA.sources).find((s) => s.url === sitting.source_url) ?? { url: sitting.source_url, label: sitting.publisher, edition: "Official sitting record", verifiedOn: sitting.read_on, sha256: null };
    return { id: `${sitting.exam_key}:${sitting.date}:${sitting.publisher}:${sitting.deadline_type}`, sitting, format: getSittingFormat(sitting), windowConfirmed, registrationOpens: windowConfirmed ? sitting.registration_opens : null, registrationCloses: windowConfirmed ? sitting.registration_closes : null, closesAtTime: windowConfirmed ? sitting.closes_at_time ?? null : null, source };
  });
}
export interface CalendarEntry { id: string; sitting: OfficialSitting; format: SittingFormat | undefined; deadlines: CalendarRow[] }
/** Includes a sitting on its final day in Vienna; no fabricated dates after the published horizon. */
export function selectCalendarEntries({ now = new Date(), exam, through = CALENDAR_DATA.through }: { now?: Date; exam?: OfficialExamKey; through?: string } = {}, rows: readonly CalendarRow[] = calendarRows()): CalendarEntry[] {
  const groups = new Map<string, CalendarEntry>();
  for (const row of rows) {
    const s = row.sitting;
    if ((s.date_end ?? s.date) < viennaToday(now) || s.date > through || (exam && s.exam_key !== exam)) continue;
    const id = `${s.exam_key}:${s.date}`;
    const entry = groups.get(id);
    if (entry) entry.deadlines.push(row);
    else groups.set(id, { id, sitting: s, format: row.format, deadlines: [row] });
  }
  return [...groups.values()].sort((a, b) => a.sitting.date.localeCompare(b.sitting.date) || a.sitting.exam_key.localeCompare(b.sitting.exam_key));
}
export function calendarLanguage(value: string | string[] | undefined): FormatLanguage { return value === "en" ? "en" : "de"; }
