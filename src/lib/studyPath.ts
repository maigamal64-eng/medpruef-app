/**
 * Study-path milestones (Phase A.1).
 *
 * A PURE presentation layer on top of the existing study-plan generator
 * (`src/lib/studyPlan.ts`) and the self-aging Austrian sitting calendar
 * (`src/lib/exam-dates.ts`). It does NOT change the generator's math —
 * it derives a "path to exam day" (the weeks-out milestone ladder + the
 * two hard anchors) from the user's exam date alone, so the study-plan
 * page and the home guided-path card can render the same milestones.
 *
 * Methodology basis: the documented "weeks-out countdown" model
 * (Foundation -> Build -> Consolidate -> Taper), anchored to the real
 * sitting date and the registration deadline. See
 * reviews/uiux-overhaul-2026-06-25/A0-methodology.md (P7).
 *
 * Austrian lens only. No em dashes in user-facing copy.
 */

import {
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  asPuypExamType,
  isOfficialWindowOpen,
} from "./exam-dates";

export type PhaseKey = "foundation" | "build" | "consolidate" | "taper";
export type PhaseStatus = "past" | "current" | "upcoming";

export interface StudyPhase {
  key: PhaseKey;
  label: { de: string; en: string };
  blurb: { de: string; en: string };
  /** Inclusive ISO start (YYYY-MM-DD) of the phase window. */
  startISO: string;
  /** Inclusive ISO end (YYYY-MM-DD) of the phase window (the exam day for taper). */
  endISO: string;
  status: PhaseStatus;
}

export type RegistrationLevel = "quiet" | "soon" | "urgent" | "passed";

export interface RegistrationStatus {
  deadlineISO: string;
  daysLeft: number; // negative once passed
  level: RegistrationLevel;
}

export interface StudyPathSummary {
  examISO: string;
  /** Whole days from `now` to the exam (>=0; 0 = exam is today). */
  daysLeft: number;
  phases: StudyPhase[];
  currentPhaseKey: PhaseKey;
  /** null when the user's exam date does not match a known sitting (custom / Pharma). */
  registration: RegistrationStatus | null;
}

const MS_PER_DAY = 86_400_000;

/** Whole-day difference (toISO - fromISO), tolerant of time components. */
function diffDays(fromISO: string, toISO: string): number {
  const a = parseLocal(fromISO);
  const b = parseLocal(toISO);
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Parse YYYY-MM-DD (ignores any time suffix) into a local midnight Date. */
function parseLocal(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Exam-date minus N days, as ISO. */
function minusDays(examISO: string, n: number): string {
  const d = parseLocal(examISO);
  d.setDate(d.getDate() - n);
  return toISO(d);
}

const PHASE_META: Record<PhaseKey, Pick<StudyPhase, "label" | "blurb">> = {
  foundation: {
    label: { de: "Grundlagen", en: "Foundation" },
    blurb: {
      de: "Neues Material lernen, breit abdecken. Wiederholung von Anfang an einstreuen.",
      en: "Learn new material, build broad coverage. Weave in review from day one.",
    },
  },
  build: {
    label: { de: "Aufbau", en: "Build" },
    blurb: {
      de: "Neues Material abschließen, Fragenpensum erhöhen, erste volle Übungsrunde.",
      en: "Finish new material, raise your question volume, first full practice run.",
    },
  },
  consolidate: {
    label: { de: "Wiederholung", en: "Review" },
    blurb: {
      de: "Kein neues Material mehr. Schwächere Fächer wiederholen und gezielt nacharbeiten.",
      en: "No new material. Review weaker subjects and target your gaps.",
    },
  },
  taper: {
    label: { de: "Letzte Tage", en: "Final days" },
    blurb: {
      de: "Leichte, gezielte Wiederholung. Logistik klären, schlafen, ruhig bleiben.",
      en: "Light, focused review. Sort logistics, sleep, stay calm.",
    },
  },
};

// Weeks-out boundaries (days before the exam), per the countdown model.
const TAPER_DAYS = 7; // final week
const CONSOLIDATE_FROM = 28; // ~4 weeks out
const BUILD_FROM = 56; // ~8 weeks out

/**
 * Build the 4-rung phase ladder anchored to the exam date. Rungs are
 * fixed weeks-out windows; "current" is whichever contains `now`. Users
 * with a short window simply start further along the ladder (earlier
 * rungs render as `past`), which is the honest behaviour.
 */
export function buildPhaseLadder(examISO: string, now: Date = new Date()): StudyPhase[] {
  const nowISO = toISO(now);
  const daysLeft = diffDays(nowISO, examISO);

  const windows: Array<{ key: PhaseKey; startISO: string; endISO: string }> = [
    { key: "foundation", startISO: minusDays(examISO, 3650), endISO: minusDays(examISO, BUILD_FROM) },
    { key: "build", startISO: minusDays(examISO, BUILD_FROM), endISO: minusDays(examISO, CONSOLIDATE_FROM) },
    { key: "consolidate", startISO: minusDays(examISO, CONSOLIDATE_FROM), endISO: minusDays(examISO, TAPER_DAYS) },
    { key: "taper", startISO: minusDays(examISO, TAPER_DAYS), endISO: examISO },
  ];

  const currentKey = phaseKeyForDaysLeft(daysLeft);

  return windows.map((w) => {
    let status: PhaseStatus;
    if (w.key === currentKey) status = "current";
    else if (diffDays(nowISO, w.endISO) < 0) status = "past";
    else status = "upcoming";
    return { ...w, label: PHASE_META[w.key].label, blurb: PHASE_META[w.key].blurb, status };
  });
}

/** Which phase a given days-left value falls into. */
export function phaseKeyForDaysLeft(daysLeft: number): PhaseKey {
  if (daysLeft <= TAPER_DAYS) return "taper";
  if (daysLeft <= CONSOLIDATE_FROM) return "consolidate";
  if (daysLeft <= BUILD_FROM) return "build";
  return "foundation";
}

/**
 * Find the registration deadline for the user's exam date, IF that date
 * matches an OFFICIAL sitting (C7 `OFFICIAL_SITTINGS`) of the user's bank.
 * Custom dates return null, so the deadline rung is hidden.
 *
 * W1-CAL (2026-10-10): reads the official MedUni Wien SIP4a/SIP5a and
 * Rezeptierkunde/Gerichtsmedizin rows, never the postgraduate ÖÄK dates.
 * The Stichprobentest returns null on purpose: each sitting has two
 * deadlines from two publishers, and this rung renders one "register now"
 * date, which would pick one for the learner.
 */
export function registrationFor(
  activeExam: string,
  examISO: string,
  now: Date = new Date(),
): RegistrationStatus | null {
  const bank = asPuypExamType(activeExam);
  if (!bank || bank === "kmp_innsbruck") return null;
  const keys = OFFICIAL_KEYS_BY_BANK[bank];
  const day = examISO.slice(0, 10);
  const sitting = OFFICIAL_SITTINGS.find(
    (s) => keys.includes(s.exam_key) && s.date === day && s.deadline_type === "registration",
  );
  if (!sitting || !sitting.registration_closes) return null;

  const daysLeft = diffDays(toISO(now), sitting.registration_closes);
  let level: RegistrationLevel;
  // Vienna wall-clock: the Rezeptierkunde window closes at 12:00 on its day.
  if (daysLeft < 0 || !isOfficialWindowOpen(sitting, now)) level = "passed";
  else if (daysLeft <= 7) level = "urgent";
  else if (daysLeft <= 21) level = "soon";
  else level = "quiet";

  return { deadlineISO: sitting.registration_closes, daysLeft, level };
}

/**
 * The full path summary for a user with an exam date. Returns null when
 * the exam is today/past (caller shows the "update your date" state).
 */
export function buildStudyPath(
  examISO: string,
  activeExam: string,
  now: Date = new Date(),
): StudyPathSummary | null {
  if (!examISO || !/^\d{4}-\d{2}-\d{2}/.test(examISO)) return null;
  const daysLeft = diffDays(toISO(now), examISO);
  if (daysLeft < 0) return null;

  return {
    examISO: examISO.slice(0, 10),
    daysLeft,
    phases: buildPhaseLadder(examISO, now),
    currentPhaseKey: phaseKeyForDaysLeft(daysLeft),
    registration: registrationFor(activeExam, examISO, now),
  };
}
