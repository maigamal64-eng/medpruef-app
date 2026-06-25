/**
 * Honest, banded readiness signal (Phase A.2).
 *
 * Replaces a pass-probability number. A predicted pass-% on a practice
 * bank is statistically unsupported and, under a pass-until-you-pass
 * guarantee, a liability (it forecasts the result we guarantee). So this
 * computes a BAND ("how ready your practice looks") from observable
 * inputs, and the raw composite NEVER leaves the server: callers surface
 * only the band, the descriptive factor sub-scores, and the trend.
 *
 * Inputs + banding follow reviews/uiux-overhaul-2026-06-25/A0-methodology.md
 * (P6 readiness-via-trend). Thresholds are tunable starting points, not
 * pass laws. No em dashes in any user-facing copy this module feeds.
 */

export type ReadinessBand =
  | "just_started"
  | "building"
  | "on_track"
  | "exam_ready_looking";

export type Trend = "up" | "flat" | "down";

export type FactorKey = "coverage" | "accuracy" | "consistency" | "pace";

export interface ReadinessInput {
  /** 0..1 topic-weighted fraction of in-scope topics with enough practice. */
  coverageFraction: number;
  /** Recent accuracy across covered topics, 0..100. */
  recentAccuracyPct: number;
  /** 0..1 consistency (active days + goal hit in the last week). */
  consistencyScore: number;
  /** 0..1 actual-vs-expected pace from the plan, or null when no exam date. */
  paceRatio: number | null;
  /** Total distinct days the user has studied. */
  activeDaysTotal: number;
  /** Studied at least once in the last 7 days. */
  activeInLast7Days: boolean;
  /** Direction of recent accuracy over time. */
  trend: Trend;
}

export interface ReadinessResult {
  band: ReadinessBand;
  /** Descriptive 0..1 sub-scores for the factor bars (NOT a prediction). */
  factors: {
    coverage: number;
    accuracy: number;
    consistency: number;
    pace: number | null;
  };
  trend: Trend;
  /** The single weakest available factor → drives the "what moves this up" tip. */
  lowestFactor: FactorKey;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// Weights (sum to 1 with pace; renormalised without it). Coverage + accuracy lead.
const W_WITH_PACE = { coverage: 0.3, accuracy: 0.3, pace: 0.25, consistency: 0.15 };
const W_NO_PACE = { coverage: 0.4, accuracy: 0.4, consistency: 0.2 };

/**
 * Pure readiness computation. The composite score is computed here to
 * pick the band and is intentionally NOT returned.
 */
export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const C = clamp01(input.coverageFraction);
  // 50% accuracy -> 0, 90% -> 1.
  const A = clamp01((input.recentAccuracyPct - 50) / 40);
  const K = clamp01(input.consistencyScore);
  const hasPace = input.paceRatio !== null && input.paceRatio !== undefined;
  const P = hasPace ? clamp01(input.paceRatio as number) : null;

  const composite = hasPace
    ? W_WITH_PACE.coverage * C +
      W_WITH_PACE.accuracy * A +
      W_WITH_PACE.pace * (P as number) +
      W_WITH_PACE.consistency * K
    : W_NO_PACE.coverage * C + W_NO_PACE.accuracy * A + W_NO_PACE.consistency * K;

  // Banding with hard gates so a near-zero factor can't read "ready".
  let band: ReadinessBand;
  if (C < 0.15 || input.activeDaysTotal < 3) {
    band = "just_started";
  } else if (composite >= 0.72 && C >= 0.75 && input.recentAccuracyPct >= 70 && input.trend !== "down" && input.activeInLast7Days) {
    band = "exam_ready_looking";
  } else if (composite >= 0.45 && C >= 0.5 && A > 0) {
    band = "on_track";
  } else {
    band = "building";
  }

  // Lowest available factor (pace excluded when absent).
  const candidates: Array<[FactorKey, number]> = [
    ["coverage", C],
    ["accuracy", A],
    ["consistency", K],
  ];
  if (P !== null) candidates.push(["pace", P]);
  candidates.sort((a, b) => a[1] - b[1]);
  const lowestFactor = candidates[0][0];

  return {
    band,
    factors: { coverage: C, accuracy: A, consistency: K, pace: P },
    trend: input.trend,
    lowestFactor,
  };
}

/**
 * Derive a 0..1 consistency score from gamification-style signals.
 * Active in the last ~7 days + hitting the daily goal pushes it up;
 * idleness decays it. Pure + side-effect free.
 */
export function consistencyFromActivity(opts: {
  currentStreak: number;
  daysSinceLastStudy: number; // 0 = studied today
  hitGoalToday: boolean;
}): number {
  // Recency: studied today/yesterday is strong; decays over a week.
  const recency = clamp01(1 - opts.daysSinceLastStudy / 7);
  // Streak: saturates around a week of consecutive days.
  const streak = clamp01(opts.currentStreak / 7);
  const goal = opts.hitGoalToday ? 1 : 0;
  // Recency leads (a current state), streak builds it, goal is a bonus.
  return clamp01(0.5 * recency + 0.35 * streak + 0.15 * goal);
}
