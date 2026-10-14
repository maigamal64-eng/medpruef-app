/**
 * a-fo-07: report a stale-key answer for the shadow evidence. Server only.
 *
 * Always one console line '[answer] key_mismatch' with the question id only
 * (no user, no answer). Vercel runtime logs keep about a day, so the same
 * event also goes to Sentry as an info message (tag key_mismatch, extra
 * questionId only), at most once per question per hour per instance so a
 * re-keyed question answered by many learners cannot flood the quota.
 */
import type { AnswerKeyGuardMode } from "@/lib/answer-key-fingerprint";

const SENTRY_EVERY_MS = 60 * 60 * 1000;
const MAX_TRACKED = 500;
const lastSent = new Map<number, number>();

/** Exported for tests. */
export function shouldSendToSentry(questionId: number, now: number = Date.now()): boolean {
  const last = lastSent.get(questionId);
  if (last !== undefined && now - last < SENTRY_EVERY_MS) return false;
  if (lastSent.size >= MAX_TRACKED) lastSent.clear();
  lastSent.set(questionId, now);
  return true;
}

/** Exported for tests. */
export function resetKeyMismatchReports(): void {
  lastSent.clear();
}

export function reportKeyMismatch(questionId: number, mode: AnswerKeyGuardMode): void {
  try {
    console.warn("[answer] key_mismatch", { questionId, mode });
  } catch {
    /* console never breaks the route */
  }
  if (!shouldSendToSentry(questionId)) return;
  (async () => {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.withScope((scope) => {
        scope.setLevel("info");
        scope.setTag("key_mismatch", mode);
        scope.setTag("route", "/api/answer");
        scope.setExtra("questionId", questionId);
        Sentry.captureMessage("[answer] key_mismatch");
      });
    } catch {
      /* a broken Sentry setup must not break the route */
    }
  })();
}
