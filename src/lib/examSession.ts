/**
 * examSession — durable persistence for an in-progress mock exam.
 *
 * The mock exam (answers + 4-hour timer + the question set) previously lived
 * ONLY in React component state, so a refresh, a crash, or a deploy-time PWA
 * hard-reload wiped hours of work mid-exam (bugs B-01 + B-02). This module is
 * the single source of truth for the saved-exam blob and its localStorage key,
 * shared between the exam page (saves/restores) and PWAInstall (defers its
 * auto-reload while an exam is active).
 *
 * Design notes:
 *  - The `questions` array is persisted verbatim, in order. Answers are keyed
 *    by position (`answers[currentIdx]`), NOT by question id, and the exam
 *    page builds the array non-deterministically (Fisher-Yates per topic +
 *    random EKG injection). Re-fetching on restore would reshuffle and
 *    silently mis-map every answer, so we store the exact array.
 *  - The timer is stored as an absolute `startedAt` (epoch ms). On restore we
 *    derive the remaining time from wall-clock, so the countdown stays honest
 *    across the gap (and an exam that expired while the tab was gone restores
 *    straight to results).
 *  - `flaggedIdxs` is a Set in component state; it is serialised as an array.
 *  - A `v` version field lets us discard incompatible older blobs on load.
 *  - Naming mirrors the existing `medpruef_quiz_autosave` precedent.
 */

/** Historical ownerless key. Never read this from a normal account load. */
const LEGACY_EXAM_SESSION_KEY = "medpruef_exam_autosave";
const EXAM_SESSION_KEY_PREFIX = "medpruef_exam_autosave:v1:";
const EXAM_SESSION_VERSION = 1 as const;

// Mirror of the exam page's exam duration so a restored timer can be bounded
// without importing page-level constants. Kept in sync with EXAM_DURATION_S.
const EXAM_DURATION_S = 4 * 60 * 60; // 4 hours

export interface SavedExamQuestion {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  difficulty: number;
  exam_dates: string[];
  options?: unknown;
  n_correct?: number;
  image_url?: string;
}

export interface SavedExamSession {
  v: number;
  /** Absolute start time of the exam, epoch ms — the timer is derived from this. */
  startedAt: number;
  durationS?: number;
  finishedAt?: number;
  timeExpired?: boolean;
  /** Question set, in the exact order the exam was taken in. */
  questions: SavedExamQuestion[];
  /** questionIndex → selected option indices (multi-select). */
  answers: Record<number, number[]>;
  /** Flagged question indices (serialised from the live Set). */
  flaggedIdxs: number[];
  /** Currently-viewed question index. */
  currentIdx: number;
  /** Which exam part was configured (all | sip4 | sip5 | custom). */
  selectedPart: string;
  /** The exam source (kenntnispruefung | kmp_innsbruck | pharma). */
  examSource: string;
  /** Stable idempotency key for the completed-history write. */
  attemptId?: string;
  /** When this blob was last written, epoch ms (staleness diagnostics). */
  savedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function examSessionKey(accountId: string): string | null {
  const normalized = accountId.trim();
  return normalized ? `${EXAM_SESSION_KEY_PREFIX}${encodeURIComponent(normalized)}` : null;
}

function parseExamSession(raw: string | null): SavedExamSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedExamSession;
    if (!parsed || parsed.v !== EXAM_SESSION_VERSION) return null;
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
    if (typeof parsed.startedAt !== "number" || !Number.isFinite(parsed.startedAt)) return null;
    if (!parsed.answers || typeof parsed.answers !== "object" || Array.isArray(parsed.answers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist the in-progress exam. Best-effort: a serialisation/quota failure
 * never throws into the exam UI (the worst case is losing autosave, not the
 * live in-memory exam).
 */
export function saveExamSession(
  accountId: string,
  data: Omit<SavedExamSession, "v" | "savedAt">,
): boolean {
  const key = examSessionKey(accountId);
  if (!isBrowser() || !key) return false;
  try {
    const blob: SavedExamSession = {
      ...data,
      v: EXAM_SESSION_VERSION,
      savedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(blob));
    return true;
  } catch {
    return false;
    /* swallow — quota or serialisation failure must not break the exam */
  }
}

/**
 * Read the saved exam, or null if none / incompatible / unparseable.
 * Validates the shape just enough to trust `questions`/`answers` downstream.
 */
export function loadExamSession(accountId: string): SavedExamSession | null {
  const key = examSessionKey(accountId);
  if (!isBrowser() || !key) return null;
  try {
    return parseExamSession(localStorage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * Inspect the pre-account-scoped autosave for an explicit ownership prompt.
 * This does not copy or delete the data. Callers must not resume it directly.
 */
export function loadLegacyExamSession(): SavedExamSession | null {
  if (!isBrowser()) return null;
  try {
    return parseExamSession(localStorage.getItem(LEGACY_EXAM_SESSION_KEY));
  } catch {
    return null;
  }
}

/**
 * Claim the ownerless legacy exam only after the signed-in learner explicitly
 * confirms ownership. The legacy copy is removed only after the scoped copy
 * has been persisted successfully.
 */
export function claimLegacyExamSession(accountId: string): SavedExamSession | null {
  const key = examSessionKey(accountId);
  if (!isBrowser() || !key) return null;
  try {
    // Never replace an account's existing exam with the ownerless legacy blob.
    if (parseExamSession(localStorage.getItem(key))) return null;
    const legacy = parseExamSession(localStorage.getItem(LEGACY_EXAM_SESSION_KEY));
    if (!legacy) return null;
    localStorage.setItem(key, JSON.stringify(legacy));
    localStorage.removeItem(LEGACY_EXAM_SESSION_KEY);
    return legacy;
  } catch {
    return null;
  }
}

/** Explicitly discard the ownerless legacy exam after the learner declines it. */
export function discardLegacyExamSession(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(LEGACY_EXAM_SESSION_KEY);
  } catch {
    /* swallow */
  }
}

/** Remove the saved exam (called on every terminal path: submit + timer-zero). */
export function clearExamSession(accountId: string): void {
  const key = examSessionKey(accountId);
  if (!isBrowser() || !key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* swallow */
  }
}

/**
 * Whether an exam is currently in progress. Read FRESH from storage at call
 * time (PWAInstall mounts before any exam starts, so a mount snapshot would be
 * stale). Powers B-02: PWAInstall defers its auto-reload while this is true.
 */
export function isExamActive(accountId?: string): boolean {
  if (accountId !== undefined) return loadExamSession(accountId) !== null;
  // PWAInstall may only need to defer a reload, and can do so without knowing
  // the signed-in identity. This reports presence only; it never returns or
  // exposes session contents without an explicit accountId.
  if (!isBrowser()) return false;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(EXAM_SESSION_KEY_PREFIX) && parseExamSession(localStorage.getItem(key))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Remaining seconds for a restored exam, derived from wall-clock so the timer
 * stays honest across the away-gap. Clamped to [0, EXAM_DURATION_S]; 0 means
 * the exam expired while the user was away.
 */
export function remainingSeconds(startedAt: number, durationS = EXAM_DURATION_S): number {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const left = durationS - elapsed;
  if (left < 0) return 0;
  if (left > durationS) return durationS;
  return left;
}

/** Completed attempts have a separate account-scoped outbox; starting never clears it. */
const pendingKey = (accountId: string) => `medpruef_exam_pending:v1:${encodeURIComponent(accountId)}`;
export function loadPendingExams(accountId: string): SavedExamSession[] {
  if (!isBrowser() || !accountId.trim()) return [];
  try {
    const rows = JSON.parse(localStorage.getItem(pendingKey(accountId)) || "[]");
    return Array.isArray(rows) ? rows.map(row => parseExamSession(JSON.stringify(row))).filter((row): row is SavedExamSession => !!row && !!row.attemptId && typeof row.finishedAt === "number") : [];
  } catch { return []; }
}
export function savePendingExam(accountId: string, session: Omit<SavedExamSession, "v" | "savedAt">): boolean {
  if (!isBrowser() || !accountId.trim() || !session.attemptId) return false;
  try {
    const rows = loadPendingExams(accountId).filter(row => row.attemptId !== session.attemptId);
    localStorage.setItem(pendingKey(accountId), JSON.stringify([...rows, { ...session, v: EXAM_SESSION_VERSION, savedAt: Date.now() }]));
    window.dispatchEvent(new Event("mp-exam-pending"));
    return true;
  } catch { return false; }
}
export function acknowledgePendingExam(accountId: string, attemptId: string): void {
  if (!isBrowser() || !accountId.trim()) return;
  try { localStorage.setItem(pendingKey(accountId), JSON.stringify(loadPendingExams(accountId).filter(row => row.attemptId !== attemptId))); window.dispatchEvent(new Event("mp-exam-pending")); } catch { /* retain on failure */ }
}
