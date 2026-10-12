/**
 * Onboarding save and resume (UX-ONB-25, ONB-55).
 *
 *  - Pending sync: every onboarding write is queued under a per-user key
 *    before the request goes out, replayed on the next load, on return to the
 *    tab and when the browser comes back online, and cleared only after a 2xx.
 *    The payload carries only what the learner chose; nothing the learner did
 *    not change is written. A newer local choice replaces an older queued one.
 *  - Draft: the current step and choices persist for 24 hours per user, so a
 *    discarded iOS tab or a closed tab resumes where the learner was.
 *
 * Language is never part of the payload: only the explicit language picker
 * writes the language preference (UX-ONB-01 cut 1).
 */
import { safeStorage } from "@/lib/safe-storage";

export const PENDING_KEY = "medpruef_onboarding_pending";
export const DRAFT_KEY = "medpruef_onboarding_draft";
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface OnboardingSyncPayload {
  examSource?: string;
  /** ISO date, or null to leave the date unset. Undefined = not chosen. */
  examDate?: string | null;
  dailyGoal?: number;
  /** True once the learner finished the flow (stamps onboarding_completed_at). */
  completed?: boolean;
}

interface Pending { payload: OnboardingSyncPayload; queuedAt: number; failures: number }

type Fetcher = (input: string, init: RequestInit & { timeoutMs?: number }) => Promise<Response>;

const key = (base: string, userId: string) => `${base}:${userId}`;

export function readPending(userId: string): Pending | null {
  try {
    const raw = safeStorage.getItem(key(PENDING_KEY, userId));
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    return p && typeof p === "object" && p.payload ? p : null;
  } catch {
    return null;
  }
}

function writePending(userId: string, p: Pending | null): void {
  try {
    if (p) safeStorage.setItem(key(PENDING_KEY, userId), JSON.stringify(p));
    else safeStorage.removeItem(key(PENDING_KEY, userId));
  } catch { /* storage blocked: the in-flight request is the only attempt */ }
}

/** Merge a new choice into the queue (newer fields win), keeping the failure count. */
export function queueOnboardingSync(userId: string, payload: OnboardingSyncPayload, now = Date.now()): Pending {
  const prev = readPending(userId);
  const merged: Pending = {
    payload: { ...(prev?.payload ?? {}), ...payload, completed: Boolean(prev?.payload.completed || payload.completed) },
    queuedAt: now,
    failures: prev?.failures ?? 0,
  };
  writePending(userId, merged);
  return merged;
}

/** Send the queued payload once. Returns "done" (2xx, cleared), "failed" or "empty". */
export async function replayOnboardingSync(userId: string, fetcher: Fetcher): Promise<"done" | "failed" | "empty"> {
  const pending = readPending(userId);
  if (!pending) return "empty";
  const { payload } = pending;
  const pref: Record<string, string | number | null> = {};
  if (payload.examSource) pref.activeExam = payload.examSource;
  if (payload.examDate !== undefined) pref.examDate = payload.examDate;
  if (typeof payload.dailyGoal === "number" && payload.dailyGoal > 0) pref.dailyGoal = payload.dailyGoal;
  try {
    if (Object.keys(pref).length > 0) {
      const res = await fetcher("/api/user/exam-preference", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pref), timeoutMs: 8_000,
      });
      if (!res.ok) throw new Error(`exam-preference ${res.status}`);
    }
    if (payload.completed) {
      const res = await fetcher("/api/user/onboarding-complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examSource: payload.examSource, examDate: payload.examDate ?? null, dailyGoal: payload.dailyGoal }),
        timeoutMs: 8_000,
      });
      if (!res.ok) throw new Error(`onboarding-complete ${res.status}`);
    }
    // Clear only if nothing newer was queued while the request was in flight.
    const latest = readPending(userId);
    if (latest && latest.queuedAt === pending.queuedAt) writePending(userId, null);
    return "done";
  } catch {
    const latest = readPending(userId);
    if (latest) writePending(userId, { ...latest, failures: latest.failures + 1 });
    return "failed";
  }
}

export interface OnboardingDraft<T> { step: number; data: T; at: number }

export function readDraft<T>(userId: string, now = Date.now()): OnboardingDraft<T> | null {
  try {
    const raw = safeStorage.getItem(key(DRAFT_KEY, userId));
    const d = raw ? (JSON.parse(raw) as OnboardingDraft<T>) : null;
    if (!d || typeof d.step !== "number" || now - d.at > DRAFT_TTL_MS) return null;
    return d;
  } catch {
    return null;
  }
}

export function writeDraft<T>(userId: string, step: number, data: T, now = Date.now()): void {
  try { safeStorage.setItem(key(DRAFT_KEY, userId), JSON.stringify({ step, data, at: now })); } catch { /* blocked */ }
}

export function clearDraft(userId: string): void {
  try { safeStorage.removeItem(key(DRAFT_KEY, userId)); } catch { /* blocked */ }
}
