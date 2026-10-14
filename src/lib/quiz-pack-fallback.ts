/**
 * a-fo-08 (NEXT_PUBLIC_QUIZ_PACK_FALLBACK): keep practising while the server
 * is slow or failing. Default off; track-A switches it on only after the stale
 * key guard (a-fo-07, ANSWER_KEY_GUARD=enforce) is live, because pack
 * questions carry the answer key of the download date and an answer graded
 * against an outdated key must be refused, never written.
 *
 * - The online next-question read gets a 5 s client deadline.
 * - A timeout or a 5xx with a downloaded pack for this account enters a
 *   sticky pack mode for 10 minutes: next questions come from the pack with
 *   no server read per tap. Answers still go to /api/answer (a 5xx or a
 *   timeout queues them in the outbox, as before).
 * - One background probe of /api/health/db every 30 s; the first healthy
 *   answer leaves pack mode early.
 *
 * Pure apart from sessionStorage (per tab, survives a reload; a blocked
 * storage keeps the state in page memory only).
 */
import { safeSessionStorage } from "@/lib/safe-storage";

export const QUIZ_FETCH_DEADLINE_MS = 5_000;
export const PACK_MODE_MS = 10 * 60_000;
export const PACK_PROBE_INTERVAL_MS = 30_000;
const KEY = "medpruef_quiz_pack_mode_v1";

export function isQuizPackFallbackEnabled(
  env: Record<string, string | undefined> = { NEXT_PUBLIC_QUIZ_PACK_FALLBACK: process.env.NEXT_PUBLIC_QUIZ_PACK_FALLBACK },
): boolean {
  return env.NEXT_PUBLIC_QUIZ_PACK_FALLBACK === "true";
}

/** The client deadline elapsed (authFetch aborts with a TimeoutError). */
export function isDeadlineError(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { name?: unknown }).name === "TimeoutError";
}

/** Only a server failure moves to the pack: a 5xx. Never a 4xx (402 paywall, 401 sign-in, 404). */
export function isServerFailureStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

interface State { until: number; userId: string }

function read(): State | null {
  try {
    const raw = safeSessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<State>;
    return typeof parsed.until === "number" && typeof parsed.userId === "string" ? { until: parsed.until, userId: parsed.userId } : null;
  } catch {
    return null;
  }
}

/** Start (or extend) the 10-minute pack mode for this account. */
export function enterPackMode(userId: string, now = Date.now()): void {
  safeSessionStorage.setItem(KEY, JSON.stringify({ until: now + PACK_MODE_MS, userId } satisfies State));
}

/** True while pack mode is on for this account (another account never inherits it). */
export function isPackModeActive(userId: string | null | undefined, now = Date.now()): boolean {
  if (!userId) return false;
  const state = read();
  return !!state && state.userId === userId && now < state.until;
}

export function leavePackMode(): void {
  safeSessionStorage.removeItem(KEY);
}
