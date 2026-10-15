// Registration-window state for official sittings, shared by the client
// guidance pages (GuidanceShell) and the server-rendered answer pages. Pure:
// no React, no "use client", so a server component can call it.
import { OFFICIAL_SITTINGS, getUpcomingOfficialSittings, viennaStamp, daysUntilViennaDate, type OfficialExamKey, type OfficialSitting } from "@/lib/exam-dates";
import data from "@/lib/guidance-data/wien-deadlines.data.json";

type Sitting = OfficialSitting & { window_unconfirmed?: boolean };
export interface GuidanceWindow {
  sitting: Sitting;
  state: "open" | "upcoming" | "closed" | "unconfirmed";
  daysRemaining: number | null;
}

export function guidanceWindow(sitting: Sitting, now: Date): GuidanceWindow {
  const unconfirmed = sitting.window_unconfirmed || data.unconfirmed_windows.some((entry) => entry.exam_key === sitting.exam_key && entry.date === sitting.date);
  if (unconfirmed || !sitting.registration_closes) return { sitting, state: "unconfirmed", daysRemaining: null };
  const stamp = viennaStamp(now);
  if (stamp >= `${sitting.registration_closes} ${sitting.closes_at_time ?? "24:00"}`) return { sitting, state: "closed", daysRemaining: null };
  const state = sitting.registration_opens && stamp.slice(0, 10) < sitting.registration_opens ? "upcoming" : "open";
  return { sitting, state, daysRemaining: state === "open" ? daysUntilViennaDate(sitting.registration_closes, now) : null };
}

export function getGuidanceWindows(exams: readonly OfficialExamKey[], now: Date, sittings: readonly Sitting[] = OFFICIAL_SITTINGS): { next: GuidanceWindow[]; unconfirmed: GuidanceWindow[]; closed: boolean } {
  // Use Vienna's date even when the shared selector uses UTC-day granularity.
  const localDay = new Date(`${viennaStamp(now).slice(0, 10)}T12:00:00Z`);
  const windows = getUpcomingOfficialSittings({ filingUniversity: "wien", now: localDay }, sittings)
    .filter((s) => exams.includes(s.exam_key))
    .map((s) => guidanceWindow(s, now));
  const candidates = windows.filter((w) => w.state === "open" || w.state === "upcoming");
  candidates.sort((a, b) => (a.sitting.registration_closes ?? "").localeCompare(b.sitting.registration_closes ?? ""));
  const firstClose = candidates[0]?.sitting.registration_closes;
  return {
    next: candidates.filter((w) => w.sitting.registration_closes === firstClose),
    unconfirmed: windows.filter((w) => w.state === "unconfirmed"),
    closed: windows.some((w) => w.state === "closed"),
  };
}
