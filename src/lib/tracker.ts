/**
 * MedPrüf Client-Side Tracker
 * Queues events and flushes them to /api/track in batches.
 * Supports sendBeacon on page unload for reliability.
 */

import type { MentorClientEvent } from "@/lib/mentor/telemetry";
import { getSessionToken } from '@/lib/auth';
/** sendBeacon cannot carry the required signed header. Keepalive fetch can. */
function sendTrack(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const token = getSessionToken();
  if (!token) return Promise.resolve(new Response(null, { status: 204 }));
  // AbortSignal.timeout is missing before Safari 16; tracking must never throw.
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5_000) : undefined;
    return fetch(input, { ...init, headers: { 'Content-Type': 'application/json', 'x-session-token': token }, signal });
  } catch (error) {
    return Promise.reject(error);
  }
}


export type TrackEventType = MentorClientEvent
  // UX-GLOBAL-32 canonical names (src/lib/analytics-events.ts is the allowlist).
  | "paywall_click"
  | "plan_selected"
  | "checkout_started"
  | "trial_terms_viewed"
  | "language_changed"
  | "offline_sync"
  | "offline_download_started"
  | "pwa_install_prompt_shown"
  | "pwa_install_prompt_accepted"
  | "modal_shown"
  | "session_started"
  | "session_completed"
  | "due_review_started"
  | "due_count_shown"
  | "note_review"
  | "home_ready"
  | "next_step_shown"
  | "error_state_shown"
  | "home_load_failed"
  | "offline_state"
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

async function flushEvents(): Promise<void> {
  if (_queue.length === 0) return;

  const batch = _queue.splice(0);
  const payload = JSON.stringify({
    sessionId: _sessionId,
    userId: _userId,
    events: batch,
  });

  try {
    const response = await sendTrack("/api/track", {
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
  void sendTrack('/api/track', { method: 'POST', body: payload, keepalive: true }).catch(() => {});
  _queue = [];
}

export function initTracker(userId: string): void {
  if (typeof window === "undefined") return;
  if (_initialized && _userId === userId) return;

  _userId = userId;
  // A page reload starts a new visit. Soft navigation keeps this in-memory ID.
  _sessionId = generateId();
  _initialized = true;

  // Create session record
  sendTrack("/api/track", {
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
        // Store only an origin and route, never query parameters or URL tokens.
        referrer: (() => {
          try {
            const referrer = new URL(document.referrer);
            return `${referrer.origin}${referrer.pathname}`.slice(0, 300);
          } catch { return null; }
        })(),
        path: window.location.pathname,
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
        void sendTrack('/api/track', { method: 'POST', body: payload, keepalive: true }).catch(() => {});
      } catch {
        /* non-critical */
      }
    }
  });

  trackEvent("session_start", {}); // the row carries user_id; ids never travel in event data (UX-GLOBAL-32)
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
    sendTrack("/api/track", {
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
