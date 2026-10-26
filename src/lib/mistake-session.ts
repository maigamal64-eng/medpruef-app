/**
 * Session length for "Offene Fehler wiederholen" (/quiz?practiceMode=wrong&open=1).
 *
 * The auto-start used the daily goal (20) as the session target for every
 * mode, so a learner with 7 mistakes saw "x von 20" and one with 45 stopped
 * after 20 with no count. The session is now exactly the learner's open
 * mistakes (up to the server page cap); when the count is unknown the session
 * is open-ended and ends when the pool is empty. Never padded with other
 * questions: the server pool for this mode contains mistakes only.
 */
export const MISTAKE_SESSION_CAP = 200;

export interface MistakeSessionPlan {
  /** Questions in this session; null = open-ended (count unknown). */
  target: number | null;
  /** Open mistakes beyond the cap, to be reviewed in a follow-up round. */
  remaining: number;
}

export function planMistakeSession(openTotal: number | null | undefined): MistakeSessionPlan {
  if (typeof openTotal !== "number" || !Number.isFinite(openTotal) || openTotal < 0) {
    return { target: null, remaining: 0 };
  }
  const total = Math.floor(openTotal);
  const target = Math.min(total, MISTAKE_SESSION_CAP);
  return { target, remaining: total - target };
}
