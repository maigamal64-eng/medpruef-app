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

export type ReplayDecision = "saved" | "drop_unavailable" | "drop_plan" | "drop_conflict" | "keep_auth" | "retry";

/**
 * Pure: what a replay response means for the queued row. A 409 is never
 * retried: re-sending a key the server already holds could count twice.
 */
export function replayDecision(status: number, body: { error?: unknown } | null = null): ReplayDecision {
  if (status >= 200 && status < 300) return "saved";
  if (status === 401 || status === 403) return "keep_auth";
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

async function flushQueue(): Promise<void> {
  if (draining) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const userId = getStoredSession()?.user?.id;
  // Never drain a local queue into an account that did not create it.
  if (!userId) return;
  draining = true;
  const result = emptySyncResult();
  try {
    const queue: PendingAnswer[] = pendingAnswersForUser(await drainPendingAnswers(), userId);
    for (const p of queue) {
      try {
        // The account can change while this queue is being drained. Check
        // immediately before each request so later rows never cross sessions.
        if (getStoredSession()?.user?.id !== userId) break;
        const res = await authFetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: p.questionId,
            requestId: p.id,
            userAnswer: p.userAnswer,
            isCorrect: p.isCorrect,
            timeSpentMs: p.timeSpentMs,
          }),
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
          if (attempts >= MAX_REPLAY_ATTEMPTS) {
            await removePendingAnswer(p.id);
            result.gaveUp += 1;
          } else {
            await updatePendingAnswer({ ...p, attempts });
          }
        } else {
          await removePendingAnswer(p.id);
          if (decision === "drop_plan") result.plan += 1;
          else if (decision === "drop_conflict") result.conflict += 1;
          else result.unavailable += 1;
        }
      } catch {
        // Network flake — stop the loop; whatever we didn't drain
        // will retry on the next `online` event.
        break;
      }
    }
  } catch (e) {
    console.error("[offlineSync] drain failed", e);
  } finally {
    draining = false;
    const touched = result.sent + result.unavailable + result.plan + result.conflict + result.gaveUp + result.waitingForLogin;
    if (touched > 0 && typeof window !== "undefined") {
      try { sessionStorage.setItem(OFFLINE_SYNC_EVENT, JSON.stringify(result)); } catch { /* storage blocked */ }
      window.dispatchEvent(new CustomEvent<OfflineSyncResult>(OFFLINE_SYNC_EVENT, { detail: result }));
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
