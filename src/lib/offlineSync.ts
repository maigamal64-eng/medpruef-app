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
import {
  drainPendingAnswers,
  removePendingAnswer,
  type PendingAnswer,
} from "@/lib/offlineDb";

let initialized = false;
let draining = false;

async function flushQueue(): Promise<void> {
  if (draining) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  draining = true;
  try {
    const queue: PendingAnswer[] = await drainPendingAnswers();
    for (const p of queue) {
      try {
        const res = await authFetch("/api/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: p.questionId,
            userAnswer: p.userAnswer,
            isCorrect: p.isCorrect,
            timeSpentMs: p.timeSpentMs,
          }),
        });
        if (res.ok) {
          await removePendingAnswer(p.id);
        } else if (res.status === 401 || res.status === 403) {
          // Auth gone — leave queued; user may be in a session-expired
          // state. Next online event or manual login + retry will drain.
          break;
        } else if (res.status === 404) {
          // Question was deleted server-side — drop the orphan so it
          // doesn't loop. 4xx for bad data is permanent, not flaky.
          await removePendingAnswer(p.id);
        }
        // Any other 5xx: leave queued, next online event retries.
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
