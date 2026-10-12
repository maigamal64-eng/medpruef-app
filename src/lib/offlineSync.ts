"use client";

/**
 * offlineSync — auto-drain queued answers to /api/answer when the
 * browser comes back online.
 *
 * Called once at app boot (from `TrackerInit`), this listens to the
 * `online` event and, when fired, reads every queued answer via
 * `drainPendingAnswers`, POSTs each to `/api/answer`, and removes the
 * IDB row only after a 2xx response. Failures keep the row queued so
 * the next reconnect retries it — idempotent, loss-tolerant.
 *
 * Uses `authFetch` (not the raw `fetch`) so the x-user-id session
 * header is attached — /api/answer now rejects bodies without it under
 * the 2026-04-15 auth-guard regime.
 *
 * Safe to call multiple times — tracks `initialized` module-locally
 * and is a no-op on re-invocation. Also attempts a drain on boot in
 * case the user is already online and had queued answers from a
 * previous session.
 *
 * a-stability (2026-10-12, outage 14:04-14:28 UTC): answers also land here
 * when the server times out or answers 5xx while the device is online. The
 * drain therefore also runs on tab return and on a backoff timer while rows
 * remain (requestAnswerSync after a queue write), stops at the first
 * server failure instead of hammering, and never drops a row for server
 * unavailability alone: a row is given up only after MAX_REPLAY_ATTEMPTS
 * failed tries AND GIVE_UP_AFTER_MS since it was queued. Every replay
 * reuses the row's request id, so the server's idempotency key (answer
 * history client_request_id / flashcard_reviews) makes a retry of a write
 * that did commit a duplicate: no second XP, streak or count.
 */

import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import {
  drainPendingAnswers,
  pendingAnswersForUser,
  removePendingAnswer,
  updatePendingAnswer,
  type PendingAnswer,
} from "@/lib/offlineDb";

let initialized = false;
let draining = false;

/** UX-PRA-45: what one replay did, shown once as a status line. */
export interface OfflineSyncResult {
  sent: number;
  /** Question removed or changed (404, 409 unavailable). */
  unavailable: number;
  /** Free allowance reached (402). */
  plan: number;
  /** The server already holds another answer under this key (409 conflict). */
  conflict: number;
  /** Five failed attempts. */
  gaveUp: number;
  /** Still queued because the session expired (401/403). */
  waitingForLogin: number;
}

export const OFFLINE_SYNC_EVENT = "medpruef:offline-sync-result";
export const MAX_REPLAY_ATTEMPTS = 5;
/** A server-unavailable row is kept at least this long (outages are retried, not dropped). */
export const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Backoff between automatic drains while rows remain: 15 s doubling to 5 min. */
export const RETRY_BASE_MS = 15_000;
export const RETRY_MAX_MS = 5 * 60_000;

/**
 * Pure: should a failed live save go to the device outbox? null = no
 * response at all (network failure or timeout); 408/425/429 and 5xx are
 * transient. Any other 4xx is a real refusal and must not be retried.
 */
export function isRetryableSaveStatus(status: number | null): boolean {
  return status === null || status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Pure: a retryable failure drops the row only when it is both old and tried often. */
export function shouldGiveUp(p: Pick<PendingAnswer, "attempts" | "createdAt">, attempts: number, now: number = Date.now()): boolean {
  const created = Date.parse(p.createdAt);
  const age = Number.isFinite(created) ? now - created : Number.POSITIVE_INFINITY;
  return attempts >= MAX_REPLAY_ATTEMPTS && age >= GIVE_UP_AFTER_MS;
}

/**
 * Pure: least-tried questions first, then oldest, so one stuck row cannot
 * block the rest. Rows for the same question stay in the order they were
 * answered (the newest-attempt rules read that order).
 */
export function replayOrder(rows: PendingAnswer[]): PendingAnswer[] {
  const groups = new Map<number, PendingAnswer[]>();
  for (const row of [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const group = groups.get(row.questionId) ?? [];
    group.push(row);
    groups.set(row.questionId, group);
  }
  const maxAttempts = (g: PendingAnswer[]) => Math.max(...g.map((r) => r.attempts ?? 0));
  return [...groups.values()]
    .sort((a, b) => maxAttempts(a) - maxAttempts(b) || a[0].createdAt.localeCompare(b[0].createdAt))
    .flat();
}

/** Pure: the body a replay sends; the same request id, plus the flashcard grade/kind when queued. */
export function replayBody(p: PendingAnswer): Record<string, unknown> {
  return {
    questionId: p.questionId,
    requestId: p.id,
    userAnswer: p.userAnswer,
    isCorrect: p.isCorrect,
    timeSpentMs: p.timeSpentMs,
    ...(typeof p.grade === "number" ? { grade: p.grade } : {}),
    ...(p.kind ? { kind: p.kind } : {}),
  };
}

/** Pure: delay before the next automatic drain after `failures` failed drains in a row. */
export function retryDelayMs(failures: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, Math.min(failures, 10)));
}

export type ReplayDecision = "saved" | "drop_unavailable" | "drop_plan" | "drop_conflict" | "keep_auth" | "retry";

/**
 * Pure: what a replay response means for the queued row. A 409 is never
 * retried: re-sending a key the server already holds could count twice.
 */
export function replayDecision(status: number, body: { error?: unknown } | null = null): ReplayDecision {
  if (status >= 200 && status < 300) return "saved";
  if (status === 401 || status === 403) return "keep_auth";
  // Timeouts and rate limits (edge or platform) are transient.
  if (status === 408 || status === 425 || status === 429) return "retry";
  if (status === 402) return "drop_plan";
  if (status === 404) return "drop_unavailable";
  if (status === 409) {
    const error = typeof body?.error === "string" ? body.error : "";
    return /another answer/i.test(error) ? "drop_conflict" : "drop_unavailable";
  }
  if (status >= 400 && status < 500) return "drop_unavailable";
  return "retry";
}

export function emptySyncResult(): OfflineSyncResult {
  return { sent: 0, unavailable: 0, plan: 0, conflict: 0, gaveUp: 0, waitingForLogin: 0 };
}

let failedDrains = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDrain(delayMs: number): void {
  if (typeof window === "undefined") return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // A pass already running finishes first; try again after it.
    if (draining) { scheduleDrain(RETRY_BASE_MS); return; }
    void flushQueue();
  }, delayMs);
}

/**
 * Ask for a drain soon, e.g. right after an answer was queued because the
 * server timed out or answered 5xx. Debounced; safe to call often. During a
 * run of failed passes the current backoff is kept (no faster than it).
 */
export function requestAnswerSync(delayMs: number = RETRY_BASE_MS): void {
  scheduleDrain(failedDrains > 0 ? Math.max(delayMs, retryDelayMs(failedDrains)) : delayMs);
}

/** Exported for tests: one drain pass. Resolves when the pass is over. */
export async function flushQueue(): Promise<void> {
  if (draining) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const userId = getStoredSession()?.user?.id;
  // Never drain a local queue into an account that did not create it.
  if (!userId) return;
  draining = true;
  const result = emptySyncResult();
  // Rows left for a later pass because the server was unavailable.
  let serverUnavailable = false;
  try {
    const queue: PendingAnswer[] = replayOrder(pendingAnswersForUser(await drainPendingAnswers(), userId));
    for (const p of queue) {
      try {
        // The account can change while this queue is being drained. Check
        // immediately before each request so later rows never cross sessions.
        if (getStoredSession()?.user?.id !== userId) break;
        const res = await authFetch("/api/answer", {
          method: "POST",
          skipAuthRedirect: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(replayBody(p)),
        });
        const body = res.ok ? null : await res.json().catch(() => null);
        const decision = replayDecision(res.status, body);
        if (decision === "saved") {
          await removePendingAnswer(p.id);
          result.sent += 1;
        } else if (decision === "keep_auth") {
          // Auth gone: leave queued; the next online event or a login drains it.
          result.waitingForLogin += queue.length - queue.indexOf(p);
          break;
        } else if (decision === "retry") {
          const attempts = (p.attempts ?? 0) + 1;
          if (shouldGiveUp(p, attempts)) {
            await removePendingAnswer(p.id);
            result.gaveUp += 1;
            continue;
          }
          await updatePendingAnswer({ ...p, attempts });
          // The server is struggling: stop here and come back after a pause
          // instead of sending every queued row into the outage.
          serverUnavailable = true;
          break;
        } else {
          await removePendingAnswer(p.id);
          if (decision === "drop_plan") result.plan += 1;
          else if (decision === "drop_conflict") result.conflict += 1;
          else result.unavailable += 1;
        }
      } catch {
        // Network flake or timeout: the write may or may not have landed.
        // Keep the row (same request id, so a landed write replays as a
        // duplicate) and stop; a later pass retries it.
        try { await updatePendingAnswer({ ...p, attempts: (p.attempts ?? 0) + 1 }); } catch { /* storage blocked */ }
        serverUnavailable = true;
        break;
      }
    }
  } catch (e) {
    console.error("[offlineSync] drain failed", e);
  } finally {
    draining = false;
    if (serverUnavailable) {
      failedDrains += 1;
      scheduleDrain(retryDelayMs(failedDrains));
    } else {
      failedDrains = 0;
    }
    const touched = result.sent + result.unavailable + result.plan + result.conflict + result.gaveUp + result.waitingForLogin;
    if (touched > 0 && typeof window !== "undefined") {
      try { sessionStorage.setItem(OFFLINE_SYNC_EVENT, JSON.stringify(result)); } catch { /* storage blocked */ }
      try { window.dispatchEvent(new CustomEvent<OfflineSyncResult>(OFFLINE_SYNC_EVENT, { detail: result })); } catch { /* no event target */ }
    }
  }
}

/**
 * Mount-once initializer. Call from a client component that runs once
 * per app session (e.g. TrackerInit).
 */
export function initOfflineSync(): void {
  if (typeof window === "undefined") return;
  if (initialized) return;
  initialized = true;

  window.addEventListener("online", () => {
    void flushQueue();
  });
  // a-stability: a server outage ends without an `online` event; returning
  // to the tab is a good moment to try again.
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void flushQueue();
    });
  }

  // Boot-time drain covers the "user came back after being offline
  // while the tab was closed" case — no `online` event fires because
  // the page loads already-online.
  if (typeof navigator !== "undefined" && navigator.onLine) {
    // Defer to the next tick so the app is fully mounted first.
    setTimeout(() => {
      void flushQueue();
    }, 1500);
  }
}
