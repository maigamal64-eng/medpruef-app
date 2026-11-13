/**
 * Outbox replay for one KP-DE run (3d). The attempt route moves one step at a
 * time and a new run starts at "anamnese", so catching the server up means
 * posting every missing step in order with the learner's current text and
 * marks. Pure: the poster is injected, so the order is unit-tested without a
 * network. A network failure, 429 or 5xx stops quietly and keeps the run for
 * the next try; any other 4xx stops with "rejected" and keeps the local copy.
 */
import type { DeKpStep } from "./index";
import { isStep, needsFinalPost, nextServerStep, type DeKpSession } from "./case-run";

export interface AttemptBody {
  attemptId: string;
  slug: string;
  step: DeKpStep;
  answers: DeKpSession["answers"];
  marks: DeKpSession["marks"];
  source: DeKpSession["source"];
}

export interface PostResult {
  /** HTTP status, 0 for a network failure. */
  status: number;
  /** The step the server now holds, when it answered with the saved attempt. */
  step?: unknown;
}

export type Poster = (body: AttemptBody) => Promise<PostResult>;
export type SyncState = "synced" | "offline" | "rejected";

const RETRYABLE = (status: number) => status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;

export async function syncRun(session: DeKpSession, post: Poster): Promise<{ session: DeKpSession; state: SyncState; posts: DeKpStep[] }> {
  let cur = session;
  const posts: DeKpStep[] = [];
  let postedDone = false;
  for (let guard = 0; guard < 8; guard += 1) {
    const next = nextServerStep(cur.serverStep ?? null, cur.screen ?? "anamnese_input");
    const finalPost = next === null && needsFinalPost(cur) && !postedDone;
    const step: DeKpStep | null = next ?? (finalPost ? "done" : null);
    if (step === null) {
      return { session: needsFinalPost(cur) ? { ...cur, finalAcked: true } : cur, state: "synced", posts };
    }
    const res = await post({ attemptId: cur.attemptId, slug: cur.slug, step, answers: cur.answers, marks: cur.marks, source: cur.source });
    posts.push(step);
    if (res.status < 200 || res.status >= 300) return { session: cur, state: RETRYABLE(res.status) ? "offline" : "rejected", posts };
    if (step === "done") postedDone = true;
    cur = { ...cur, serverStep: isStep(res.step) ? res.step : step };
  }
  return { session: cur, state: "offline", posts };
}
