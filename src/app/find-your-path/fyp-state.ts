/**
 * Pure state helpers for the /find-your-path wizard (UX-PUB-33).
 *
 * The step and the result view live in the URL (?step=1..3, ?step=result)
 * so the browser Back button moves one step back; the selection lives in
 * sessionStorage so a refresh restores it. Everything here is pure and
 * DOM-free so it can be unit tested.
 */
import type { PuypExamType } from "@/lib/exam-dates";

export const FYP_STATE_KEY = "medpruef_fyp_state_v1";
export const FYP_STEP_COUNT = 3;
export const FYP_DEFAULT_GOAL = 20;

/** 0..2 are the wizard steps, "result" is the Your Path view. */
export type FypStep = 0 | 1 | 2 | "result";
export type FypRoute = PuypExamType | "unsure";

export interface FypState {
  route: FypRoute | null;
  examDate: string;
  weak: string[];
  dailyGoal: number;
  step: FypStep;
}

export const FYP_INITIAL: FypState = {
  route: null,
  examDate: "",
  weak: [],
  dailyGoal: FYP_DEFAULT_GOAL,
  step: 0,
};

const ROUTES: readonly FypRoute[] = ["kenntnispruefung", "kmp_innsbruck", "pharma", "unsure"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The real bank behind a route choice; "unsure" is not a bank. */
export function examTypeOf(route: FypRoute | null): PuypExamType | null {
  return route && route !== "unsure" ? route : null;
}

/** "?step=2" → 1, "?step=result" → "result", anything else → null. */
export function parseStepParam(value: string | null | undefined): FypStep | null {
  if (value === "result") return "result";
  if (!value || !/^[1-9]$/.test(value)) return null;
  const n = Number(value) - 1;
  return n < FYP_STEP_COUNT ? (n as 0 | 1 | 2) : null;
}

/** The ?step value for a step (1-based, or "result"). */
export function stepParam(step: FypStep): string {
  return step === "result" ? "result" : String(step + 1);
}

/** The URL search string for a step, keeping any other query params. */
export function searchWithStep(search: string, step: FypStep): string {
  const params = new URLSearchParams(search);
  params.set("step", stepParam(step));
  return `?${params.toString()}`;
}

/**
 * A step is reachable only with a real bank chosen; without one every
 * later step and the result fall back to step 1.
 */
export function clampStep(step: FypStep, route: FypRoute | null): FypStep {
  return examTypeOf(route) ? step : 0;
}

/** Validate a stored record; unknown or broken fields fall back to defaults. */
export function restoreState(raw: string | null | undefined): FypState {
  if (!raw) return { ...FYP_INITIAL };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...FYP_INITIAL };
  }
  if (!data || typeof data !== "object") return { ...FYP_INITIAL };
  const d = data as Record<string, unknown>;
  const route = ROUTES.includes(d.route as FypRoute) ? (d.route as FypRoute) : null;
  const examDate = typeof d.examDate === "string" && ISO_DAY.test(d.examDate) ? d.examDate : "";
  const weak = Array.isArray(d.weak)
    ? d.weak.filter((w): w is string => typeof w === "string" && w.length > 0 && w.length <= 80).slice(0, 20)
    : [];
  const goal = typeof d.dailyGoal === "number" && Number.isInteger(d.dailyGoal) && d.dailyGoal >= 5 && d.dailyGoal <= 100
    ? d.dailyGoal
    : FYP_DEFAULT_GOAL;
  const rawStep = d.step === "result" ? "result" : typeof d.step === "number" ? parseStepParam(String(d.step + 1)) : null;
  return { route, examDate, weak, dailyGoal: goal, step: clampStep(rawStep ?? 0, route) };
}

export function serializeState(state: FypState): string {
  return JSON.stringify(state);
}

/**
 * The step to show on load: the URL wins over the stored step, and both
 * are clamped to what the stored selection allows.
 */
export function initialStep(urlStep: FypStep | null, saved: FypState): FypStep {
  return clampStep(urlStep ?? saved.step, saved.route);
}
