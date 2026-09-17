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
  | "guest_start"
  | "quiz_start"
  | "quiz_complete"
  | "answer_time"
  | "page_leave"
  | "scroll_depth"
  | "error"
  | "feature_use"
  | "translation"
  // Referral-funnel events (rescue-sprint §4, 2026-04-24).
  // Dashboard card / /referrals page / post-quiz share chip all
  // feed the same `referral_code_copied` bucket — `data.source` tells
  // the analyst where the click originated.
  | "referral_code_copied"
  | "referral_share_prompt_shown"
  | "referral_share_prompt_clicked"
  // Direct social-share deeplink clicks from /referrals (Telegram /
  // WhatsApp / X) — added 2026-04-28 to measure which channel
  // actually drives signed-up referrals after the pricing reset.
  | "referral_share_clicked"
  // AI-chat paywall events (rescue-sprint §3, 2026-04-24).
  // Fires when a free user hits /api/ai-chat and gets 402/tier-gated.
  // Lets us measure paywall-hit rate per free user and verify the
  // explicit "Pro feature" copy reduces "KI funktioniert nicht" feedback.
  | "ai_chat_paywall_shown";

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
    const response = await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    // Tracking is best-effort. Retrying a failed batch every five seconds
    // amplified the 17 Sep Supabase outage and retained an ever-growing queue.
    // A future event will be sent normally; this batch is intentionally lost.
    if (!response.ok) return;
  } catch {
    // Network failures are intentionally dropped. Never let analytics create a
    // retry storm or consume memory while the database is unavailable.
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
        screenWidth: window.screen?.width,
        screenHeight: window.screen?.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        referrer: document.referrer || null,
        url: window.location.href,
      },
    }),
  }).catch(() => {});

  // Start auto-flush interval
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = setInterval(() => {
    flushEvents().catch(() => {});
  }, FLUSH_INTERVAL_MS);

  // On tab hide OR pagehide: flush remaining events via sendBeacon
  // AND call the /api/track endSession branch so user_sessions gets
  // its ended_at + duration_seconds populated. Previously endSession
  // was exported but never called, so every session in the DB had
  // `ended_at IS NULL` (verified: all 1,240 rows were orphaned).
  // Analytics audit P1-A1. Uses a 5-minute grace window so users
  // switching tabs don't end their session prematurely.
  let _endTimer: ReturnType<typeof setTimeout> | null = null;
  const GRACE_MS = 5 * 60 * 1000;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      flushBeacon();
      if (_endTimer) clearTimeout(_endTimer);
      _endTimer = setTimeout(() => {
        endSession().catch(() => {});
      }, GRACE_MS);
    } else if (document.visibilityState === "visible") {
      // User came back within the grace window — cancel the end.
      if (_endTimer) {
        clearTimeout(_endTimer);
        _endTimer = null;
      }
    }
  };
  window.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", () => {
    flushBeacon();
    // pagehide is a near-certain signal the user is leaving the
    // tab for good — fire the endSession call directly via beacon
    // if available, otherwise fall back to fetch().
    if (_sessionId && _userId) {
      const payload = JSON.stringify({
        sessionId: _sessionId,
        userId: _userId,
        endSession: true,
      });
      try {
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon("/api/track", blob);
        } else {
          fetch("/api/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* non-critical */
      }
    }
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
