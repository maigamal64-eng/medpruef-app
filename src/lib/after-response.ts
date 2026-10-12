import { after } from "next/server";

/**
 * Run optional work (analytics writes) after the response is sent, so a slow
 * or frozen database never holds the learner's request (a-db-timeouts).
 * The function stays alive for the task up to the route's maxDuration.
 *
 * Outside a Next.js request scope (unit tests, scripts) `after` throws; the
 * task then runs inline so callers behave the same. Task errors are logged,
 * never thrown: losing an analytics row is acceptable, a broken page is not.
 */
export async function afterResponse(label: string, task: () => Promise<void>): Promise<void> {
  const guarded = async () => {
    try {
      await task();
    } catch (err) {
      console.warn(`[${label}] deferred write failed`, err instanceof Error ? err.message : err);
    }
  };
  try {
    after(guarded);
  } catch {
    await guarded();
  }
}
