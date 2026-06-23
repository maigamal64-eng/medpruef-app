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

const EXAM_SESSION_KEY = "medpruef_exam_autosave";
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
  /** When this blob was last written, epoch ms (staleness diagnostics). */
  savedAt: number;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Persist the in-progress exam. Best-effort: a serialisation/quota failure
 * never throws into the exam UI (the worst case is losing autosave, not the
 * live in-memory exam).
 */
export function saveExamSession(
  data: Omit<SavedExamSession, "v" | "savedAt">,
): void {
  if (!isBrowser()) return;
  try {
    const blob: SavedExamSession = {
      ...data,
      v: EXAM_SESSION_VERSION,
      savedAt: Date.now(),
    };
    localStorage.setItem(EXAM_SESSION_KEY, JSON.stringify(blob));
  } catch {
    /* swallow — quota or serialisation failure must not break the exam */
  }
}

/**
 * Read the saved exam, or null if none / incompatible / unparseable.
 * Validates the shape just enough to trust `questions`/`answers` downstream.
 */
export function loadExamSession(): SavedExamSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(EXAM_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedExamSession;
    if (!parsed || parsed.v !== EXAM_SESSION_VERSION) return null;
    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
    if (typeof parsed.startedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Remove the saved exam (called on every terminal path: submit + timer-zero). */
export function clearExamSession(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(EXAM_SESSION_KEY);
  } catch {
    /* swallow */
  }
}

/**
 * Whether an exam is currently in progress. Read FRESH from storage at call
 * time (PWAInstall mounts before any exam starts, so a mount snapshot would be
 * stale). Powers B-02: PWAInstall defers its auto-reload while this is true.
 */
export function isExamActive(): boolean {
  return loadExamSession() !== null;
}

/**
 * Remaining seconds for a restored exam, derived from wall-clock so the timer
 * stays honest across the away-gap. Clamped to [0, EXAM_DURATION_S]; 0 means
 * the exam expired while the user was away.
 */
export function remainingSeconds(startedAt: number): number {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const left = EXAM_DURATION_S - elapsed;
  if (left < 0) return 0;
  if (left > EXAM_DURATION_S) return EXAM_DURATION_S;
  return left;
}
