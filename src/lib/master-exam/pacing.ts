/**
 * Pacing line (pick-exam-pace A): an optional line in the exam drawer, OFF by default,
 * that compares progress with the per-question target. It never runs a second clock:
 * it reads the elapsed time of the one exam timer.
 */

export const PACING_DEFAULT_ON = false;
/** Within this many questions of the target counts as on track. */
export const PACING_TOLERANCE_QUESTIONS = 2;

export type PaceState = "ahead" | "on_track" | "behind";

export interface PaceSnapshot {
  state: PaceState;
  /** Questions answered so far. */
  answered: number;
  /** Questions the target says should be answered by now (capped at the total). */
  expected: number;
  /** answered - expected; positive means ahead. */
  deltaQuestions: number;
  /** Average seconds per answered question so far; null before the first answer. */
  avgSecondsPerAnswered: number | null;
}

export function paceSnapshot(elapsedS: number, answered: number, total: number, targetS: number): PaceSnapshot {
  const safeElapsed = Math.max(0, elapsedS);
  const safeAnswered = Math.max(0, Math.min(answered, total));
  const expected = targetS > 0 ? Math.min(total, Math.floor(safeElapsed / targetS)) : 0;
  const delta = safeAnswered - expected;
  const state: PaceState = delta > PACING_TOLERANCE_QUESTIONS ? "ahead" : delta < -PACING_TOLERANCE_QUESTIONS ? "behind" : "on_track";
  return {
    state,
    answered: safeAnswered,
    expected,
    deltaQuestions: delta,
    avgSecondsPerAnswered: safeAnswered > 0 ? safeElapsed / safeAnswered : null,
  };
}

/**
 * Per-question dwell time from navigation events, so the results screen can show the
 * average time per subject. `visits` are [questionIndex, enteredAtMs] in order; the last
 * visit closes at `endMs`.
 */
export function dwellSecondsByIndex(visits: readonly [number, number][], endMs: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < visits.length; i++) {
    const [idx, start] = visits[i];
    const stop = i + 1 < visits.length ? visits[i + 1][1] : endMs;
    const s = Math.max(0, (stop - start) / 1000);
    out[idx] = (out[idx] ?? 0) + s;
  }
  return out;
}
