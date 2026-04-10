/**
 * MedPrüf Client-Side Tracker
 * Queues events and flushes them to /api/track in batches.
 * Supports sendBeacon on page unload for reliability.
 */

export type TrackEventType =
  | "page_view"
  | "question_start"
  | "question_answer"
  | "topic_select"
  | "exam_change"
  | "search"
  | "bookmark"
  | "filter_change"
  | "session_start"
  | "session_end"
  | "exam_start"
  | "exam_end"
  | "exam_abandon"
  | "explanation_view"
  | "ai_chat_open"
  | "ai_chat_message"
  | "flashcard_flip"
  | "flashcard_rate"
  | "note_save"
  | "highlight_add"
  | "theme_toggle"
  | "language_change"
  | "onboarding_complete"
  | "search_result_click"
  | "cta_click"
  | "login_attempt"
  | "login_success"
  | "guest_start";

interface QueuedEvent {
  type: TrackEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

const SESSION_KEY = "medpruef_session_id";
const FLUSH_INTERVAL_MS = 5000;

let _userId: string = "";
let _sessionId: string = "";
let _queue: QueuedEvent[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _initialized = false;

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateSessionId(): string {
  if (typeof sessionStorage === "undefined") return generateId();
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) return stored;
  const newId = generateId();
  sessionStorage.setItem(SESSION_KEY, newId);
  return newId;
}

async function flushEvents(): Promise<void> {
  if (_queue.length === 0) return;

  const batch = _queue.splice(0);
  const payload = JSON.stringify({
    sessionId: _sessionId,
    userId: _userId,
    events: batch,
  });

  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch {
    // Re-queue on failure (best-effort)
    _queue = [...batch, ..._queue];
  }
}

function flushBeacon(): void {
  if (_queue.length === 0) return;
  const payload = JSON.stringify({
    sessionId: _sessionId,
    userId: _userId,
    events: _queue,
  });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/track", payload);
    _queue = [];
  }
}

export function initTracker(userId: string): void {
  if (typeof window === "undefined") return;

  _userId = userId;
  _sessionId = getOrCreateSessionId();
  _initialized = true;

  // Create session record
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: _sessionId,
      userId,
      createSession: true,
      deviceInfo: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
      },
    }),
  }).catch(() => {});

  // Start auto-flush interval
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = setInterval(() => {
    flushEvents().catch(() => {});
  }, FLUSH_INTERVAL_MS);

  // Use sendBeacon on page unload
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
    }
  });
  window.addEventListener("pagehide", () => {
    flushBeacon();
  });

  trackEvent("session_start", { userId });
}

export function trackEvent(
  type: TrackEventType,
  data: Record<string, unknown> = {}
): void {
  if (typeof window === "undefined") return;
  _queue.push({ type, data, timestamp: new Date().toISOString() });
}

export function trackPageView(page: string): void {
  trackEvent("page_view", { page });
}

export async function endSession(): Promise<void> {
  trackEvent("session_end", { userId: _userId });
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
  await flushEvents();

  // Mark session ended
  if (_sessionId && _userId) {
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: _sessionId,
        userId: _userId,
        endSession: true,
      }),
    }).catch(() => {});
  }
}

export { flushEvents };
export function getSessionId(): string {
  return _sessionId;
}
export function isInitialized(): boolean {
  return _initialized;
}
