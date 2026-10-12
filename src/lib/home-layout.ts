/**
 * Home layout rules (UX-HOME-15, UX-HOME-28 B, UX-HOME-64). Pure.
 */
import { MIN_TOPIC_SAMPLE } from "@/lib/learning-metrics";

/**
 * UX-HOME-15 phase A (one resolved next step as the hero primary) ships OFF.
 * The spec requires one dated week of `home_cta` baseline first; track-A turns
 * it on with NEXT_PUBLIC_HOME_NEXT_STEP=true after that baseline exists.
 */
export function isHomeNextStepEnabled(env: Record<string, string | undefined> = { NEXT_PUBLIC_HOME_NEXT_STEP: process.env.NEXT_PUBLIC_HOME_NEXT_STEP }): boolean {
  return env.NEXT_PUBLIC_HOME_NEXT_STEP === "true";
}

/** Public pages that explain each exam (UX-HOME-64). No eligibility advice; existing pages only. */
const FORMAT_PAGES: Record<string, string> = {
  kenntnispruefung: "/kenntnispruefung-wien",
  kmp_innsbruck: "/stichprobentest",
  pharma: "/pharmakologie-pruefung-wien",
};
export function examFormatHref(exam: string): string | null {
  return FORMAT_PAGES[exam] ?? null;
}

/** pick-ux-home-28 B: five topic cards on phones, weakest first, then "Alle N anzeigen". */
export const PHONE_TOPIC_COUNT = 5;

export interface RankProgress { answered: number; lastCorrectPct: number | null; accuracy: number }

/**
 * Weakest first: topics with enough answers by their newest-attempt share
 * (hit rate until that read exists), lowest first; then topics with some
 * answers; then untouched topics in bank order. Stable for equal keys.
 */
export function rankTopicsForPhone<T extends { topic: string }>(topics: readonly T[], progressOf: (topic: string) => RankProgress | null): T[] {
  const keyed = topics.map((tp, index) => {
    const p = progressOf(tp.topic);
    const answered = p?.answered ?? 0;
    const pct = p ? (p.lastCorrectPct ?? p.accuracy) : null;
    const group = answered >= MIN_TOPIC_SAMPLE ? 0 : answered > 0 ? 1 : 2;
    return { tp, index, group, pct: pct ?? 101 };
  });
  keyed.sort((a, b) => a.group - b.group || (a.group < 2 ? a.pct - b.pct : 0) || a.index - b.index);
  return keyed.map((k) => k.tp);
}
