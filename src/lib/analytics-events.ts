/**
 * Measurement contract (UX-GLOBAL-32): one event allowlist for the signed
 * tracker (/api/track) and the anonymous funnel (/api/funnel-events).
 *
 * Every event is checked here before it is stored: unknown names are dropped,
 * properties lose anything that identifies a person or carries free text
 * (email, name, token, ids in URLs, typed text), paths are normalised and a
 * UA class marks automation so QA traffic stays out of learner baselines.
 * Founder and staff accounts are excluded at read time with
 * isStaffOrTestAccount (admin money rules), never by a client flag.
 *
 * Consent: every event follows the live consent mode; the decision whether
 * anonymous pre-signup counters may run without analytics consent waits for
 * [name]'s PUB-48 sign-off. Pure module.
 */
import { normalizeTrackedPath } from './telemetry-normalize';

/** Canonical names (duplicates merged: paywall_view, language_switch, offline_banner_shown...). */
export const CANONICAL_EVENTS = {
  paywall_hit: ['gate', 'exam', 'surface', 'trigger'],
  paywall_click: ['target', 'gate'],
  cta_click: ['surface', 'slot', 'intent', 'source', 'cta', 'exam', 'tier', 'value'],
  plan_selected: ['tier', 'source'],
  checkout_started: ['source', 'tier'],
  trial_intent_carried: ['exam'],
  trial_terms_viewed: ['source'],
  trial_started: ['source'],
  language_changed: ['from', 'to', 'source'],
  offline_state: ['state'],
  offline_page_shown: [],
  offline_download_started: ['size', 'exam'],
  offline_sync: ['sent', 'dropped'],
  pwa_install_prompt_shown: ['platform'],
  pwa_install_prompt_accepted: ['platform'],
  modal_shown: ['id'],
  error_state_shown: ['page', 'status', 'region', 'reason'],
  session_started: ['source'],
  session_completed: ['source', 'count'],
  due_review_started: ['count'],
  mistake_reanswered: ['correct'],
  daily_goal_reached: ['goal'],
  plan_block_started: ['block_focus'],
  plan_block_completed: ['block_focus'],
  note_review: ['rating'],
  due_count_shown: ['count', 'surface'],
  home_ready: ['ms', 'connection'],
  // UX-HOME-53: one Home CTA event; `slot` is an enumerated value (HOME_CTA_SLOTS), never free text.
  home_cta: ['slot', 'exam', 'kind'],
  // LX-33: mock exam entry from Home or the study plan (source is home|plan).
  mock_entry_click: ['source', 'exam'],
  banner_dismissed: ['surface'],
  tg_token_failed: ['reason'],
  tg_handoff_choice: ['choice'],
  onboarding_save_failed: ['step'],
  onboarding_skip: ['step'],
  pwa_coach_shown: ['platform'],
  next_step_shown: ['kind'],
  // ONB-06 auth and onboarding funnel (anonymous endpoint).
  landing_view: ['source'],
  registration_view: ['source', 'intent', 'exam'],
  registration_success: ['source', 'intent', 'exam'],
  first_answer: ['exam'],
  checkout_intent: ['source', 'tier'],
  purchase_success: ['tier', 'value'],
} as const satisfies Record<string, readonly string[]>;

export type CanonicalEvent = keyof typeof CANONICAL_EVENTS;

/** Older tracker names still accepted (their properties are sanitised generically). */
export const LEGACY_EVENTS = [
  'home_load_failed', 'page_view', 'question_start', 'question_answer', 'topic_select', 'exam_change', 'search',
  'bookmark', 'filter_change', 'session_start', 'session_end', 'exam_start', 'exam_end', 'exam_abandon',
  'explanation_view', 'ai_chat_open', 'ai_chat_message', 'flashcard_flip', 'flashcard_rate', 'note_save',
  'highlight_add', 'theme_toggle', 'language_change', 'onboarding_complete', 'search_result_click', 'login_attempt',
  'login_success', 'guest_start', 'quiz_start', 'quiz_complete', 'answer_time', 'page_leave', 'scroll_depth',
  'error', 'feature_use', 'translation', 'referral_code_copied', 'referral_share_prompt_shown',
  'referral_share_prompt_clicked', 'referral_share_clicked', 'ai_chat_paywall_shown',
] as const;

/** Anonymous funnel endpoint: only these, never a signed identity. */
export const FUNNEL_EVENTS = [
  'landing_view', 'cta_click', 'registration_view', 'registration_success', 'first_answer', 'checkout_intent', 'purchase_success',
] as const satisfies readonly CanonicalEvent[];

const CANONICAL = new Set<string>(Object.keys(CANONICAL_EVENTS));
const LEGACY = new Set<string>(LEGACY_EVENTS);

export function isAllowedEvent(name: string): boolean {
  return CANONICAL.has(name) || LEGACY.has(name) || name.startsWith('mentor_');
}

/** Keys that identify a person or carry typed text are never stored. */
const DENY_KEYS = /^(e-?mail|name|first_?name|last_?name|full_?name|user_?name|telegram_?username|phone|token|session_?token|password|secret|user_?id|userid|text|message|note|details|query|q|answer|user_?answer|content|comment|feedback|ip)$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TOKENISH = /^(eyJ[\w-]+\.[\w-]+\.[\w-]+|[A-Za-z0-9_-]{32,})$/;
const MAX_STRING = 80;
const MAX_WORDS = 8;

function cleanValue(key: string, value: unknown): string | number | boolean | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Paths keep only the normalised pathname (query, fragment and raw ids go).
  if (/(^|_)(page|path|url|href|route)$/i.test(key)) return trimmed.startsWith('/') ? normalizeTrackedPath(trimmed) : null;
  if (!trimmed || EMAIL.test(trimmed) || TOKENISH.test(trimmed) || /userId=/i.test(trimmed)) return null;
  // Free text is not a property: long or many-word strings are dropped.
  if (trimmed.length > MAX_STRING || trimmed.split(/\s+/).length > MAX_WORDS) return null;
  return trimmed;
}

/**
 * Keep only allowed, non-identifying properties. Canonical events keep their
 * declared keys; legacy events keep any key that passes the value checks.
 */
export function sanitizeEventData(name: string, data: Record<string, unknown> | null | undefined): Record<string, string | number | boolean> {
  const allowed = (CANONICAL_EVENTS as Record<string, readonly string[]>)[name];
  const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(data ?? {})) {
    if (DENY_KEYS.test(key)) continue;
    if (allowed && !allowed.includes(key)) continue;
    const value = cleanValue(key, raw);
    if (value !== null) out[key] = value;
  }
  return out;
}

export type UaClass = 'browser' | 'automation';
/** Automation (Playwright, headless, Lighthouse, crawlers) never counts as a learner. */
export function uaClass(userAgent: string | null | undefined): UaClass {
  return /HeadlessChrome|Playwright|Puppeteer|Lighthouse|bot\b|crawler|spider|curl\//i.test(userAgent ?? '') ? 'automation' : 'browser';
}
