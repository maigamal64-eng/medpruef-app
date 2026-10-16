/**
 * Study-plan target wiring (a25: LX-01-R, LX-03-R, LX-04-R). Pure.
 *
 * The resolver lives in master-learning/plan-target (b35). This file feeds it
 * the official sittings of the learner's bank from the exam-dates SoT (the
 * same list the sitting picker offers), so a provisional target is always a
 * date the learner could also pick. No date is typed here.
 */
import {
  OFFICIAL_KEYS_BY_BANK,
  asPuypExamType,
  getUpcomingOfficialFor,
  groupOfficialByDate,
} from "./exam-dates";
import { presetForRun, type ExamPart } from "./exam-run";
import { nextSittings, resolvePlanTarget, type PlanTarget, type SittingLike } from "./master-learning/plan-target";

/** Upcoming official sitting dates for a bank, one per date, ascending. */
export function officialPlanSittings(bank: string, now: Date = new Date()): SittingLike[] {
  const key = asPuypExamType(bank);
  if (!key) return [];
  return groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[key], now })).map((g) => ({
    date: g.date,
  }));
}

export interface StudyPlanTarget extends PlanTarget {
  /** Up to three future official sittings of the bank (LX-03-R one-tap switch). */
  nextSittings: string[];
}

export function studyPlanTarget(bank: string, examDate: string | null | undefined, now: Date = new Date()): StudyPlanTarget {
  const sittings = officialPlanSittings(bank, now);
  const target = resolvePlanTarget({ examDate: examDate ?? null, sittings, now });
  return { ...target, nextSittings: nextSittings(sittings, now, 3).map((s) => s.date) };
}

/**
 * Preset used for timed mock exams in the plan (LX-04-R), or null when the
 * bank has none that can start without a live pool check. The Rezeptierkunde
 * MC preset is checked live on /exam (its reviewed rows may not exist yet), so
 * the plan never schedules a day it might not be able to open.
 */
export function simulationPresetFor(bank: string, part: Extract<ExamPart, "all" | "sip4" | "sip5"> = "all"): string | null {
  // a-cram-part-plan: a resolved SIP part runs its own enabled preset (kp_sip4 / kp_sip5).
  const preset = presetForRun(bank, part);
  if (!preset || preset.id === "rx_mc_30" || preset.requiresReviewedPool) return null;
  return preset.id;
}
