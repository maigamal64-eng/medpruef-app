/**
 * Which consolidation days become full timed simulations (LX-04-R). Pure.
 *
 * Plans shorter than 30 days get none. Longer plans get simulations at T-14
 * and T-7 (plus T-3 from 60 days), kept inside the consolidation window and at
 * least MIN_GAP_DAYS apart. When fewer than two preferred offsets fit the
 * window (a 30-day plan has a 9-day window), the fallback offsets are used.
 */
import { addDays, daysBetween } from "./plan-target";

export const MIN_PLAN_DAYS_FOR_SIMULATIONS = 30;
export const LONG_PLAN_DAYS = 60;
export const MIN_GAP_DAYS = 3;
const PREFERRED_OFFSETS = [14, 7];
const LONG_PLAN_OFFSET = 3;
const FALLBACK_OFFSETS = [7, 4];

/** a-cram-part-plan: part plans of 10 to 29 days (cramSimulationOffsets). */
export const CRAM_MIN_DAYS = 10;
export const CRAM_OFFSETS = [14, 7] as const;

/**
 * Cram run days for part plans of 10 to 29 days: T-14 and T-7 when both land
 * on or after the first plan day, else T-7 alone. Offsets (days before the
 * exam), descending. Outside that range: [].
 */
export function cramSimulationOffsets(startDay: string, examDate: string): number[] {
  const total = daysBetween(startDay, examDate);
  if (total < CRAM_MIN_DAYS || total >= MIN_PLAN_DAYS_FOR_SIMULATIONS) return [];
  return CRAM_OFFSETS.filter((o) => o >= 1 && addDays(examDate, -o) >= startDay);
}

export interface SimulationDay {
  day: string;
  /** Bank key until the exam presets land (b34 maps it to a preset id). */
  presetId: string;
  offsetDays: number;
}

export function pickSimulationDays(opts: {
  /** First plan day (ISO). */
  startDay: string;
  examDate: string;
  /** First consolidation day (ISO). */
  consolidationStart: string;
  presetId: string;
  /**
   * a-cram-part-plan: a part plan (kp_sip4 / kp_sip5). Plans of 10 to 29 days
   * then get T-14 and T-7 when both fit, else T-7, anywhere in the plan (not
   * only the review phase). Plans of 30 days or more are unchanged.
   */
  cram?: boolean;
}): SimulationDay[] {
  const total = daysBetween(opts.startDay, opts.examDate);
  if (opts.cram && total < MIN_PLAN_DAYS_FOR_SIMULATIONS) {
    return cramSimulationOffsets(opts.startDay, opts.examDate).map((offsetDays) => ({
      day: addDays(opts.examDate, -offsetDays),
      presetId: opts.presetId,
      offsetDays,
    }));
  }
  if (total < MIN_PLAN_DAYS_FOR_SIMULATIONS) return [];

  const inWindow = (offset: number) => {
    const d = addDays(opts.examDate, -offset);
    return offset >= 1 && d >= opts.consolidationStart && d >= opts.startDay;
  };
  const gapOk = (chosen: number[], offset: number) =>
    chosen.every((c) => Math.abs(c - offset) >= MIN_GAP_DAYS);

  const wanted = total >= LONG_PLAN_DAYS ? [...PREFERRED_OFFSETS, LONG_PLAN_OFFSET] : [...PREFERRED_OFFSETS];
  const chosen: number[] = [];
  for (const o of wanted) if (inWindow(o) && gapOk(chosen, o)) chosen.push(o);
  if (chosen.length < 2) {
    for (const o of FALLBACK_OFFSETS) {
      if (chosen.length >= 2) break;
      if (!chosen.includes(o) && inWindow(o) && gapOk(chosen, o)) chosen.push(o);
    }
  }
  return chosen
    .sort((a, b) => b - a)
    .map((offsetDays) => ({
      day: addDays(opts.examDate, -offsetDays),
      presetId: opts.presetId,
      offsetDays,
    }));
}
