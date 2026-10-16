"use client";

/**
 * a-public-selftest: after sign-in, the self-check result and the named
 * sitting land in the account. Called by completeAuthEntry for intent
 * "selftest" once the signed session is stored.
 *
 * - Answers go into the existing answer outbox under their stable request
 *   ids and drain through /api/answer (the quiz's own path: free-set rules,
 *   key fingerprint, duplicate-safe on replay). One drain is attempted right
 *   away (at most four seconds); the boot drain of the next page finishes it.
 * - The exam and the sitting are saved through /api/user/exam-preference (the
 *   picker path) together: the sitting only when it is still an official
 *   sitting of the bank and the account has no exam date of its own; an own
 *   date of another bank keeps the account's active exam (saveSitting).
 * - One signed `selftest_saved` row, then the record is removed.
 *
 * Only a record this browser stored is used (localStorage, one hour), so a
 * crafted link cannot write answers or a date into an account.
 */
import { authFetch } from "@/lib/authFetch";
import { getStoredSession, storeSession } from "@/lib/auth";
import { setStoredExamSource } from "@/lib/topics";
import { safeStorage } from "@/lib/safe-storage";
import { queuePendingAnswer } from "@/lib/offlineDb";
import { flushQueue } from "@/lib/offlineSync";
import { SELFTEST_PENDING_KEY, isSelftestSitting, parsePending, type SelftestPending } from "./index";

export interface CarryResult {
  ran: boolean;
  queued: number;
  sitting: "saved" | "kept_own" | "open" | "failed";
}

const DRAIN_BUDGET_MS = 4_000;

async function queueAnswers(userId: string, p: SelftestPending): Promise<number> {
  let queued = 0;
  for (const a of p.answers) {
    try {
      await queuePendingAnswer({ id: a.requestId, userId, questionId: a.id, userAnswer: a.userAnswer, isCorrect: a.isCorrect, timeSpentMs: a.timeSpentMs, keyFingerprint: a.keyFingerprint });
      queued += 1;
    } catch {
      // No IndexedDB (private mode, blocked storage): send it directly, same request id.
      try {
        const res = await authFetch("/api/answer", {
          method: "POST", timeoutMs: 8_000, skipAuthRedirect: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: a.id, requestId: a.requestId, userAnswer: a.userAnswer, isCorrect: a.isCorrect, timeSpentMs: a.timeSpentMs, keyFingerprint: a.keyFingerprint }),
        });
        if (res.ok) queued += 1;
      } catch { /* best effort */ }
    }
  }
  return queued;
}

/**
 * The exam and the sitting move together. The account's own exam date wins: when it is not an
 * upcoming official sitting of the self-check bank, neither the date nor the active exam changes
 * (the study plan keeps planning the bank that date belongs to). Otherwise the active exam becomes
 * the self-check bank, and the named sitting is saved only when the account has no date of its own.
 */
async function saveSitting(p: SelftestPending): Promise<{ sitting: CarryResult["sitting"]; examSwitched: boolean }> {
  if (p.sitting && !isSelftestSitting(p.bank, p.sitting)) return { sitting: "failed", examSwitched: false };
  try {
    const current = await authFetch("/api/user/exam-preference", { method: "GET", timeoutMs: 8_000, skipAuthRedirect: true });
    if (!current.ok) return { sitting: "failed", examSwitched: false };
    const own = ((await current.json()) as { examDate?: string | null }).examDate ?? null;
    if (own && !isSelftestSitting(p.bank, own)) return { sitting: p.sitting ? "kept_own" : "open", examSwitched: false };
    const writeDate = !!p.sitting && !own;
    const res = await authFetch("/api/user/exam-preference", {
      method: "PATCH", timeoutMs: 8_000, skipAuthRedirect: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(writeDate ? { activeExam: p.bank, examDate: p.sitting } : { activeExam: p.bank }),
    });
    if (!res.ok) return { sitting: "failed", examSwitched: false };
    const sitting: CarryResult["sitting"] = !p.sitting ? "open" : writeDate || own === p.sitting ? "saved" : "kept_own";
    return { sitting, examSwitched: true };
  } catch {
    return { sitting: "failed", examSwitched: false };
  }
}

export async function carrySelftest(nowMs: number = Date.now()): Promise<CarryResult> {
  const pending = parsePending(safeStorage.getItem(SELFTEST_PENDING_KEY), nowMs);
  const userId = getStoredSession()?.user?.id;
  if (!pending || !userId || userId.startsWith("guest_")) return { ran: false, queued: 0, sitting: "open" };

  const queued = await queueAnswers(userId, pending);
  const { sitting, examSwitched } = await saveSitting(pending);
  if (examSwitched) {
    setStoredExamSource(pending.bank);
    const current = getStoredSession();
    if (current) storeSession({ ...current, user: { ...current.user, active_exam: pending.bank } });
  }
  // The record goes once the answers are queued: a failed date save is not retried (Settings and the study plan ask again).
  safeStorage.removeItem(SELFTEST_PENDING_KEY);
  try {
    await authFetch("/api/selftest/saved", {
      method: "POST", timeoutMs: 6_000, skipAuthRedirect: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exam: pending.bank, sitting: pending.sitting ? "named" : "open", count: queued }),
    });
  } catch { /* counting is best effort */ }
  await Promise.race([flushQueue().catch(() => {}), new Promise((r) => setTimeout(r, DRAIN_BUDGET_MS))]);
  return { ran: true, queued, sitting };
}
