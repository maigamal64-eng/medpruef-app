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
  // a-quiz-load-failed-honest: result ok|error|aborted, stored = questions stored by this run, ms = run time, reason = the PackFailure on error.
  offline_download_finished: ['result', 'stored', 'ms', 'reason', 'size', 'exam'],
  offline_sync: ['sent', 'dropped'],
  pwa_install_prompt_shown: ['platform'],
  pwa_install_prompt_accepted: ['platform'],
  // a28 (LX-12, LX-13): install taps by surface and one launch per session from the installed app.
  pwa_install_clicked: ['platform', 'surface'],
  standalone_launch: ['platform', 'source'],
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
  // a-cram-part-plan: the study plan with the cram flag on (part all|sip4|sip5, days lt10|d10_13|d14_20|d21_29|d30plus),
  // and a timed part run started from the plan (source plan, preset kp_sip4|kp_sip5).
  cram_plan_view: ['part', 'days'],
  plan_simulation_start: ['source', 'preset'],
  // a-exam-calendar-feed: a tap on an add-to-calendar link; kind = google|apple|copy|download|personal.
  calendar_subscribe_click: ['exam', 'surface', 'kind'],
  banner_dismissed: ['surface'],
  // a-referral-surface: mentor_zero | home_card | exam_pass | mock_exam (ReferralSurface).
  referral_surface_shown: ['surface'],
  tg_token_failed: ['reason'],
  tg_handoff_choice: ['choice'],
  onboarding_save_failed: ['step'],
  onboarding_skip: ['step'],
  pwa_coach_shown: ['platform'],
  // J11 win-back note on Home (action is open|plans|dismiss).
  winback_note_shown: [],
  winback_note_action: ['action'],
  next_step_shown: ['kind'],
  // ONB-06 auth and onboarding funnel (anonymous endpoint).
  landing_view: ['source'],
  registration_view: ['source', 'intent', 'exam'],
  registration_success: ['source', 'intent', 'exam'],
  first_answer: ['exam'],
  checkout_intent: ['source', 'tier'],
  purchase_success: ['tier', 'value'],
  // a-study-plan-magnet (M8): a public /lernplan plan was shown (value = hours a week).
  study_plan_built: ['exam', 'value', 'source'],
  // a-code-front-door: a code was typed before signup (anonymous; code = the typed code, normalised) and, signed in, redeemed (server row code_redeemed carries kind).
  code_entered_pre_signup: ['code', 'surface'],
  code_redeemed: ['kind', 'code', 'source'],
  // a-public-selftest (anonymous): exam = bank, source = entry surface, bucket = score band (never the score),
  // sitting = named|open. selftest_saved is the server-only row written by /api/selftest/saved (never accepted by /api/track).
  selftest_start: ['exam', 'source'],
  selftest_finish: ['exam', 'bucket', 'source'],
  selftest_register_click: ['exam', 'sitting', 'source'],
  // a-partner-kit: /kooperation viewed (surface = language), a partner request stored by the contact route, (the organiser report open is a server-written activity row, not an allowlisted client event).
  partner_page_view: ['surface'],
  partner_request_sent: ['surface'],
  // a-free-set (issues 2, 3): why a quiz showed no question, and how long the
  // first question of a session took after quiz_start.
  // a-quiz-load-failed-honest: reason offline|timeout|aborted|parse|network|http|retryable, elapsed_ms since the read
  // started, error_name TimeoutError|AbortError|TypeError|SyntaxError|other, tier the audience (guest|free|trial|pro|lapsed).
  quiz_load_failed: ['status', 'reason', 'mode', 'exam', 'topics', 'elapsed_ms', 'error_name', 'tier'],
  quiz_empty: ['reason', 'mode', 'exam', 'topics'],
  question_shown: ['ms', 'mode', 'exam'],
  // a-fo-08: the quiz moved to (enter) or left (leave) the downloaded pack while online.
  quiz_pack_mode: ['state', 'reason'],
  // a-journey-engine: a Home moment was shown (moment is the journey code ask|m2..m6, exam the segment).
  moment_shown: ['moment', 'exam', 'surface'],
  // a-cram-card: variant sip_named|sip_bank|rezgm_a|rezgm_b; target plan|pricing|part|simulation|official. The sitting named from the card is the server-only sitting_set row (source cram_card, /api/user/exam-preference).
  cram_card_shown: ['variant', 'plan', 'credits'],
  cram_card_click: ['variant', 'target'],
  // a-activation-48h: a step of the first 48 hours (step from ACTIVATION_STEPS, exam the segment, lang the UI language).
  activation_step: ['step', 'exam', 'lang'],
  // a-trial-end-decision: the "your plan to your sitting" card (written by /api/trial-end; surface banner|home|paywall,
  // plan the marked v2 tier or none, exam the bank, trial auto|claim, target checkout|pricing|later).
  trial_end_card_shown: ['surface', 'plan', 'exam', 'trial'],
  trial_end_card_click: ['surface', 'plan', 'exam', 'trial', 'target'],
  // a-checkout-resume: the Home card for an opened, unpaid checkout. tier is a plan key, target is opened|cheaper|support.
  checkout_resume_shown: ['tier', 'fit'],
  checkout_resume_click: ['tier', 'target'],
  // a-checkout-confirm-v2: the confirm step before Whop (counts only; tier is a plan key, source pricing).
  checkout_confirm_shown: ['tier', 'source'],
  checkout_confirm_continue: ['tier', 'source'],
  checkout_confirm_back: ['tier', 'source'],
  // a-renewal-recovery-card: kind is requires_action|failed.
  renewal_recovery_shown: ['kind'],
  renewal_recovery_click: ['kind'],
  // a-whop-cancel-signal: renewal-off card; pricing = whether the plan link showed, target manage|pricing.
  renewal_off_shown: ['pricing'],
  renewal_off_click: ['target'],
  // a-checkout-return-read: written by /api/checkout-return and /api/checkout-feedback (bucket = seconds since the
  // redirect, page = where the learner landed, surface = home|pricing). Server-owned; never a payment id or a reason text.
  checkout_return: ['bucket', 'tier', 'page'],
  checkout_stall_shown: ['tier', 'surface'],
  checkout_stall_answered: ['reason', 'tier', 'surface'],

  // a-tg-miniapp-welcome: the Mini App welcome opened and signed in (exam the bank, lang de|en,
  // account new|existing). sitting_set is server-only (/api/user/exam-preference, source
  // tg_welcome) and deliberately not accepted from /api/track.
  tg_welcome_open: ['exam', 'lang', 'account'],
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
  'landing_view', 'cta_click', 'registration_view', 'registration_success', 'first_answer', 'checkout_intent', 'purchase_success', 'study_plan_built',
  'calendar_subscribe_click', 'code_entered_pre_signup', 'selftest_start', 'selftest_finish', 'selftest_register_click', 'partner_page_view', 'partner_request_sent',
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
/**
 * Keys that may carry a short list of enumerated strings (a-free-set issue 2:
 * quiz_start lost its topics when arrays were dropped). Each item passes the
 * same string checks; the list is capped and empty lists are dropped.
 */
const ARRAY_KEYS = new Set(['topics']);
const MAX_ARRAY_ITEMS = 12;

export type SanitizedValue = string | number | boolean | string[];

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
export function sanitizeEventData(name: string, data: Record<string, unknown> | null | undefined): Record<string, SanitizedValue> {
  const allowed = (CANONICAL_EVENTS as Record<string, readonly string[]>)[name];
  const out: Record<string, SanitizedValue> = {};
  for (const [key, raw] of Object.entries(data ?? {})) {
    if (DENY_KEYS.test(key)) continue;
    if (allowed && !allowed.includes(key)) continue;
    if (Array.isArray(raw)) {
      if (!ARRAY_KEYS.has(key)) continue;
      const items = raw
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => (typeof item === 'string' ? cleanValue(key, item) : null))
        .filter((item): item is string => typeof item === 'string');
      if (items.length > 0) out[key] = items;
      continue;
    }
    const value = cleanValue(key, raw);
    if (value !== null) out[key] = value;
  }
  return out;
}

export type UaClass = 'browser' | 'automation';
/** Automation (Playwright, headless, Lighthouse, crawlers) never counts as a learner. Cubot is a phone brand, not a bot. */
export function uaClass(userAgent: string | null | undefined): UaClass {
  return /HeadlessChrome|Playwright|Puppeteer|Lighthouse|(?<!cu)bot\b|crawler|spider|curl\//i.test(userAgent ?? '') ? 'automation' : 'browser';
}
