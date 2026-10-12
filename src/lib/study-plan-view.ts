/**
 * Pure view rules for /study-plan (a25: UX-STU-18/23/24/25/26/27, LX-04).
 * No React, no fetch. Dates come only from the exam-dates SoT and the plan.
 */
import {
  OFFICIAL_KEYS_BY_BANK,
  OFFICIAL_SITTINGS,
  asPuypExamType,
  isOfficialWindowOpen,
  type OfficialSitting,
} from "./exam-dates";
import { addDays, daysBetween } from "./master-learning/plan-target";
import { blueprintTotal, getExamPreset } from "./master-exam";
import type { StudyFocus, StudyPlan, StudyPlanDay } from "./studyPlan";

export type RegistrationLevel = "quiet" | "soon" | "urgent" | "passed";

export interface RegistrationRow {
  closes: string;
  daysLeft: number;
  level: RegistrationLevel;
  /** "muw" / "imed" for the two Stichprobentest publishers, null for a single official row. */
  publisher: "muw" | "imed" | null;
  sourceUrl: string;
}

function level(row: OfficialSitting, todayISO: string, now: Date): { daysLeft: number; level: RegistrationLevel } {
  const daysLeft = daysBetween(todayISO, row.registration_closes as string);
  if (daysLeft < 0 || !isOfficialWindowOpen(row, now)) return { daysLeft, level: "passed" };
  if (daysLeft <= 7) return { daysLeft, level: "urgent" };
  if (daysLeft <= 21) return { daysLeft, level: "soon" };
  return { daysLeft, level: "quiet" };
}

/**
 * Registration deadlines for the plan's sitting (UX-STU-24, pick-ux-stu-24 B).
 * A Stichprobentest sitting returns BOTH published deadlines with their
 * publisher, never one picked for the learner. A custom date returns none.
 */
export function registrationRows(activeExam: string, sittingISO: string, todayISO: string, now: Date = new Date()): RegistrationRow[] {
  const bank = asPuypExamType(activeExam);
  if (!bank) return [];
  const keys = OFFICIAL_KEYS_BY_BANK[bank];
  const day = sittingISO.slice(0, 10);
  const rows = OFFICIAL_SITTINGS.filter((s) => keys.includes(s.exam_key) && s.date === day && !!s.registration_closes && !s.window_unconfirmed);
  const seen = new Set<string>();
  const out: RegistrationRow[] = [];
  for (const row of rows) {
    const publisher = row.exam_key === "stichprobentest" ? (row.filing_university === "innsbruck" ? "imed" : "muw") : null;
    const key = `${row.registration_closes}|${publisher}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ closes: row.registration_closes as string, publisher, sourceUrl: row.source_url, ...level(row, todayISO, now) });
  }
  return out.sort((a, b) => a.closes.localeCompare(b.closes));
}

/** The compact line under the hero shows only when a deadline is near or passed. */
export function registrationLineVisible(rows: readonly RegistrationRow[]): boolean {
  return rows.some((r) => r.level !== "quiet");
}

export type PlanPhaseKey = "new" | "review" | "exam";
export interface PlanPhase {
  key: PlanPhaseKey;
  from: string;
  to: string;
  status: "past" | "current" | "upcoming";
}

/**
 * One phase model (UX-STU-18): the ladder is the generator's own switch day,
 * so "Wiederholung" starts the day the schedule switches.
 */
export function planPhases(plan: Pick<StudyPlan, "phaseBreak" | "generatedFor" | "dailySchedule">, todayISO: string): PlanPhase[] {
  const first = plan.dailySchedule[0]?.day ?? todayISO;
  const exam = plan.generatedFor;
  const out: PlanPhase[] = [];
  const status = (from: string, to: string): PlanPhase["status"] => (todayISO > to ? "past" : todayISO >= from ? "current" : "upcoming");
  if (plan.phaseBreak > first) out.push({ key: "new", from: first, to: addDays(plan.phaseBreak, -1), status: status(first, addDays(plan.phaseBreak, -1)) });
  const reviewFrom = plan.phaseBreak > first ? plan.phaseBreak : first;
  const reviewTo = addDays(exam, -1);
  if (reviewTo >= reviewFrom) out.push({ key: "review", from: reviewFrom, to: reviewTo, status: status(reviewFrom, reviewTo) });
  out.push({ key: "exam", from: exam, to: exam, status: status(exam, exam) });
  return out;
}

/** Plan-side focus label key (UX-STU-26): weak blocks read "Mehr üben", never "Neu". */
export function focusKey(focus: StudyFocus): "focus_new" | "focus_weak" | "focus_review" {
  return focus === "review" ? "focus_review" : focus === "weak" ? "focus_weak" : "focus_new";
}

/** Upcoming list (UX-STU-27): starts tomorrow, at most `n` days, keeps free and light days so dates do not jump. */
export function upcomingDays(plan: Pick<StudyPlan, "dailySchedule">, todayISO: string, n = 6): StudyPlanDay[] {
  return plan.dailySchedule.filter((d) => d.day > todayISO).slice(0, n);
}

/** Today's honest total (UX-STU-19): one number, no per-block ticks. */
export function todayProgress(answeredToday: number | null | undefined, goal: number): { done: number | null; toGoal: number | null; reached: boolean } {
  if (typeof answeredToday !== "number" || !Number.isFinite(answeredToday)) return { done: null, toGoal: null, reached: false };
  const done = Math.max(0, Math.floor(answeredToday));
  return { done, toGoal: Math.max(0, goal - done), reached: done >= goal };
}

/** New questions the plan reaches by the date at the current goal (UX-STU-23). */
export function reachableNew(plan: Pick<StudyPlan, "dailySchedule">, unseen: number): number {
  const planned = plan.dailySchedule.filter((d) => d.phase === "new").reduce((s, d) => s + d.totalQuestions, 0);
  return Math.max(0, Math.min(unseen, planned));
}

export interface SimulationMeta {
  presetId: string;
  questions: number;
  durationS: number;
}

/** Length of a scheduled mock exam, read from the preset (never typed on the page). */
export function simulationMeta(presetId: string): SimulationMeta | null {
  const preset = getExamPreset(presetId);
  if (!preset || !preset.enabled) return null;
  return { presetId, questions: blueprintTotal(preset.blueprint), durationS: preset.practiceDurationS };
}

/** /exam entry for a plan simulation: the bank's full run, back to the plan. */
export function simulationHref(examSource: string): string {
  const p = new URLSearchParams({ examSource, part: "all", returnTo: "/study-plan" });
  return `/exam?${p}`;
}

/** Daily-goal stepper presets (UX-STU-23). */
export const GOAL_PRESETS = [20, 35, 50, 80] as const;
