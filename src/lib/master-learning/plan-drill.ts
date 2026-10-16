/**
 * Drill days after a timed part run (a-cram-part-plan). Pure.
 *
 * The day after each run is a drill day on the subjects that run left below
 * the 60 percent practice mark. The run is read from exam_simulations by the
 * route (exam answers never write answer_history); this module only decides
 * which stored run a drill day uses.
 */
import { addDays } from "./plan-target";

/** Practice mark per subject (the 60 percent mark ExamResults shows). */
export const DRILL_BELOW = 0.6;
/** A run counts for a drill day when it was finished within this many days before it. */
export const DRILL_RUN_WINDOW_DAYS = 7;

/** One finished part run, as the drill and the cards need it. */
export interface PartRunSummary {
  presetId: string;
  /** Vienna day the run was completed (ISO). */
  day: string;
  /** Subjects of the run below 60 percent, weakest first (pct is 0..1). */
  weak: Array<{ topic: string; pct: number }>;
}

/**
 * The run a drill day uses: the newest run of the preset finished in the 7
 * days before it, and not before `notBefore` when given (a drill day after a
 * scheduled run only takes a run from that day on, so an older run never
 * fills a future drill day).
 */
export function drillRunFor(day: string, presetId: string, runs: readonly PartRunSummary[], notBefore?: string): PartRunSummary | null {
  const window = addDays(day, -DRILL_RUN_WINDOW_DAYS);
  const from = notBefore && notBefore > window ? notBefore : window;
  let best: PartRunSummary | null = null;
  for (const r of runs) {
    if (r.presetId !== presetId || r.day >= day || r.day < from) continue;
    if (!best || r.day > best.day) best = r;
  }
  return best;
}
