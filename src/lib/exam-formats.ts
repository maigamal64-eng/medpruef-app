import raw from "./exam-formats.data.json";
import { OFFICIAL_SITTINGS, viennaToday, type OfficialExamKey, type OfficialSitting } from "./exam-dates";

export type FormatLanguage = "de" | "en";
export type Localized = Record<FormatLanguage, string>;
export type FactStatus = "official" | "reported" | "not_confirmed";
export type ExamFormat = "mc" | "kaf" | "mixed" | "oral" | "not_announced";
export interface FormatSource {
  url: string;
  label: string;
  edition: string;
  verifiedOn: string;
  sha256: string | null;
}
export interface ExamRule {
  id: string;
  topic: string;
  title: Localized;
  text: Localized;
  sourceId: string;
  relatedSourceIds?: string[];
  status: FactStatus;
  scope: Localized;
}
export interface SittingFormat {
  examKey: OfficialExamKey;
  date: string;
  format: ExamFormat;
  status: FactStatus;
  expectedBy: string | null;
  expectedByStatus: FactStatus;
  verifiedOn: string;
  sourceId: string;
  sourceUrl: string;
  sourceLabel: string;
  durationMin?: number;
  note: Localized;
}
export interface ExamFormatProfile {
  key: OfficialExamKey;
  label: Localized;
  ruleIds: string[];
}
export interface ExamFormatData {
  schemaVersion: number;
  graceDays: number;
  sources: Record<string, FormatSource>;
  exams: ExamFormatProfile[];
  rules: ExamRule[];
  sittings: SittingFormat[];
  unconfirmedWindows: { examKey: OfficialExamKey; date: string; sourceId: string; read_on: string }[];
}
export const EXAM_FORMAT_DATA = raw as ExamFormatData;
export const EXAM_FORMAT_KEYS = EXAM_FORMAT_DATA.exams.map((exam) => exam.key);
export const RESERVED_FORMAT_ROUTES = ["ergebnisse", "pruefungsraum", "kommission", "aenderungen", "haeufige-fragen", "faecher", "praxis-vs-pruefung"] as const;

export function formatLanguage(value: string | string[] | undefined): FormatLanguage {
  return value === "en" ? "en" : "de";
}
export function getExamFormatProfile(key: string): ExamFormatProfile | undefined {
  return EXAM_FORMAT_DATA.exams.find((exam) => exam.key === key);
}
export function rulesForExam(key: string): ExamRule[] {
  const ids = getExamFormatProfile(key)?.ruleIds ?? [];
  return ids.map((id) => EXAM_FORMAT_DATA.rules.find((rule) => rule.id === id)).filter((rule): rule is ExamRule => rule !== undefined);
}
export function getSittingFormat(sitting: Pick<OfficialSitting, "exam_key" | "date">): SittingFormat | undefined {
  return EXAM_FORMAT_DATA.sittings.find((format) => format.examKey === sitting.exam_key && format.date === sitting.date);
}
export function isFormatWindowConfirmed(sitting: Pick<OfficialSitting, "exam_key" | "date" | "registration_closes"> & { window_unconfirmed?: boolean }): boolean {
  return !sitting.window_unconfirmed && sitting.registration_closes !== null && !EXAM_FORMAT_DATA.unconfirmedWindows.some((window) => window.examKey === sitting.exam_key && window.date === sitting.date);
}
export interface FormatCard {
  sitting: OfficialSitting;
  deadlines: OfficialSitting[];
  format: SittingFormat | undefined;
}
/** One actual sitting can have two publisher deadlines. Keep both without inventing a university rule. */
export function upcomingFormatCards(now = new Date(), exam?: string, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): FormatCard[] {
  const cards = new Map<string, FormatCard>();
  for (const sitting of sittings) {
    if ((sitting.date_end ?? sitting.date) < viennaToday(now) || (exam && sitting.exam_key !== exam)) continue;
    const key = `${sitting.exam_key}:${sitting.date}`;
    const card = cards.get(key);
    if (card) card.deadlines.push(sitting);
    else cards.set(key, { sitting, deadlines: [sitting], format: getSittingFormat(sitting) });
  }
  return [...cards.values()].sort((a, b) => a.sitting.date.localeCompare(b.sitting.date) || a.sitting.exam_key.localeCompare(b.sitting.exam_key));
}
const DATE_LOCALE: Record<FormatLanguage, string> = { de: "de-AT", en: "en-GB" };
export function formatDisplayDate(iso: string, lang: FormatLanguage): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(`${iso}T12:00:00Z`));
}
/** Fail the dated data gate if an unresolved format is left more than the allowed grace after its sitting. */
export function staleUnannouncedFormats(now = new Date(), data: ExamFormatData = EXAM_FORMAT_DATA): SittingFormat[] {
  const today = Date.parse(`${viennaToday(now)}T00:00:00Z`);
  return data.sittings.filter((record) => record.format === "not_announced" && today > Date.parse(`${record.date}T00:00:00Z`) + data.graceDays * 86_400_000);
}
