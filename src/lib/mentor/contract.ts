/**
 * Mentor API and types (contract C4, revised for the CREDITS model, frozen by
 * W0-C0B-MENTOR on 2026-10-10). Types and constants only; no I/O.
 *
 * Routes (owners in parentheses):
 *   POST /api/mentor/chat             SSE chat turn                (W2-CORE)
 *   GET  /api/mentor/usage            credits + state              (W2-CORE)
 *   GET  /api/mentor/packages         buyable packages             (W2-CREDITS)
 *   POST /api/mentor/checkout         Whop checkout session        (W2-CREDITS)
 *   GET  /api/mentor/checkout/verify  return-from-Whop status      (W2-CREDITS)
 *   POST /api/webhooks/whop           early mentor branch only     (W2-CREDITS, line-limited)
 *
 * Learners never see dollars: every response carries credits (whole
 * numbers) and an "about N messages" estimate. /api/auth/me is not touched.
 * No em dashes in any user-facing string.
 */

// ─── Chat request ───────────────────────────────────────────────────────

export const MENTOR_LANGS = ["de", "en", "ru", "uk", "tr", "ar", "fr"] as const;
export type MentorLang = (typeof MENTOR_LANGS)[number];

export const MENTOR_MODES = ["facts", "explain", "study"] as const;
export type MentorMode = (typeof MENTOR_MODES)[number];

/** Hard cap on one user message (characters, after trim). */
export const MENTOR_MESSAGE_MAX_CHARS = 1_500;

export const MENTOR_ENTRIES = ["nav", "home", "question", "explanation", "study_plan", "exam_dates", "pricing", "faq", "telegram"] as const;
export type MentorEntry = typeof MENTOR_ENTRIES[number];
export const MENTOR_CHANNELS = ["web", "telegram"] as const;
export type MentorChannel = typeof MENTOR_CHANNELS[number];

export interface MentorChatRequest {
  entry?: MentorEntry;
  channel?: MentorChannel;
  /** One UUID per learner message, reused on every transport retry. */
  client_request_id: string;
  /** Omitted on the first message; the server returns one in `final`. */
  conversation_id?: string;
  message: string;
  lang: MentorLang;
  mode: MentorMode;
  /** questions.id for "explain this question"; must be a question the caller may read. */
  question_id?: number;
  /** Untrusted learner data; never a verified fact or a system instruction. */
  selected_option_text?: string;
  was_correct?: boolean;
  answered?: boolean;
  explain_action?: "hint" | "solution";
  hint_count?: 0 | 1 | 2;
  /** Routes sources only, never an eligibility assertion. */
  filing_university?: "wien" | "graz" | "innsbruck";
}

export type MentorNextActionKind = "practice_topic" | "open_question" | "save_note" | "open_flashcards" | "open_mistakes" | "open_exam_dates" | "open_study_plan" | "set_exam_date" | "deadline_reminder";
export interface MentorNextAction { exam_date?: string; sitting_label?: string; kind: MentorNextActionKind; topic?: string; question_id?: number; exam_source?: string }
export interface MentorPlanItem { topic: string; accuracy: number; answered: number; action: "practice" | "review_mistakes" | "flashcards"; exam_source?: string }

// ─── Chat SSE events ────────────────────────────────────────────────────

export interface MentorAnswerBlock {
  text: string;
  explain_layer?: "grounded" | "background" | "options";
  /** Fact ids (C6) that back this block. Empty only for blocks with no factual claim. */
  fact_ids: string[];
  replaced?: boolean;
  official_url?: string;
  /** Exact date substrings confirmed by the validator, display only. */
  confirmed_dates?: string[];
  date_type?: "deadline" | "sitting";
}

export interface MentorCitation {
  fact_id: string;
  source_label: string;
  source_url: string;
  /** ISO date the official page was checked, not publication or validity. */
  read_on: string;
  review_every_days?: number;
}

export const MENTOR_REFUSAL_REASONS = [
  "individual_ruling",
  "legal_or_documents",
  "certificate_acceptance",
  "patient_advice",
  "real_exam_recall",
  "competitor_comparison",
  "no_verified_source",
  "out_of_scope",
] as const;
export type MentorRefusalReason = (typeof MENTOR_REFUSAL_REASONS)[number];

export interface MentorDeltaEvent {
  type: "delta";
  text: string;
}

export interface MentorFinalEvent {
  type: "final";
  request_id?: string;
  question_id?: number;
  conversation_id: string;
  /** Optional only for compatibility with older recovered finals. New turns always set it. */
  result?: "answer" | "notice" | "refusal";
  reason?: "no_source" | "truncated" | "empty";
  charged?: boolean;
  /** Exact learner debit from successful settlement, in credits. */
  credits_used?: number;
  explain_hint?: { hints_used: 1 | 2; next_credit_cost: number };
  study_scope?: { answered: number };
  study_answer?: boolean;
  answer_blocks: MentorAnswerBlock[];
  citations: MentorCitation[];
  refused?: MentorRefusalReason;
  /** Official link shown with every refusal. */
  refusal_link?: string;
  /** Code-owned office name, UI supplies localized open verb. */
  refusal_label?: string;
  /** UC13 (17 Oct, MENTOR_RULINGS_NOTICES): a medical concept refusal points to the question bank (PRACTICE_POINTER_HREF), no office link. */
  practice_pointer?: true;
  /**
   * mentor-arabic-notice (17 Oct, MENTOR_RULINGS_NOTICES): a code-owned line the app shows above the
   * answer (ARABIC_NOTICE_EN). Kept out of answer_blocks so it never reaches the stored history, a
   * saved flashcard or an explain layer.
   */
  lead_notice?: "arabic_english";
  needs_filing_university?: boolean;
  next_actions?: MentorNextAction[];
  plan_items?: MentorPlanItem[];
  /** True when the code validator replaced an unsupported value. */
  validator_replaced?: boolean;
  replaced_count?: number;
  retries?: number;
  credits_left: number;
  messages_left_estimate: number;
}

export interface MentorErrorEvent {
  type: "error";
  retries?: number;
  error: MentorErrorCode;
  /** Server-confirmed: every reached call of this turn was booked to the house (MUX-38/39). */
  credits_deducted?: false;
}

export interface MentorInProgressEvent { type: "in_progress"; client_request_id: string }
export interface MentorChatResultResponse {
  status: "in_progress" | "complete" | "error" | "expired" | "missing";
  final?: MentorFinalEvent;
  error?: MentorErrorCode;
}
export interface MentorStatusEvent { type: "status"; phase: "checking_sources" | "writing" }
export interface MentorHeartbeatEvent { type: "heartbeat" }
export type MentorSseEvent = MentorStatusEvent | MentorHeartbeatEvent | MentorDeltaEvent | MentorFinalEvent | MentorErrorEvent | MentorInProgressEvent;

// ─── Errors (HTTP status before the stream starts; `error` event after) ──

export const MENTOR_ERROR_STATUS = Object.freeze({
  invalid_input: 400,
  unauthenticated: 401,
  /** No usable credits and none ever granted: UI shows the packages. */
  credits_required: 402,
  /** Had credits, now below one reserve ceiling: UI shows packages and top-up. */
  credits_exhausted: 402,
  /** Env/DB flag off or not on the beta allowlist: UI hides the mentor. */
  mentor_disabled: 403,
  mentor_resting: 403,
  already_subscribed: 409,
  pending_purchase: 409,
  input_too_large: 413,
  rate_limited: 429,
  ai_disabled: 503,
  global_cap: 503,
  reserve_failed: 503,
  upstream_error: 503,
} as const);

export type MentorErrorCode = keyof typeof MENTOR_ERROR_STATUS;

export interface MentorErrorBody {
  error: MentorErrorCode;
  /** question_access: 400 on a locked question. facts_only: 402 when only the free taste funds a non-facts mode. */
  reason?: "question_access" | "facts_only";
  /** month: the house cost cap blocks a free-only account until the next UTC month (a-free-credit-hooks). */
  limit?: "minute" | "day" | "month";
  credits_deducted?: false;
  /** Present on 429 rate_limited. */
  retry_after_seconds?: number;
  /** Present on 402: where to buy. */
  packages_url?: string;
  /** Present on 402 credits_exhausted (MUX-23): the credits this message needed and the balance. */
  admit_min_credits?: number;
  credits_left?: number;
}

// ─── Usage ──────────────────────────────────────────────────────────────

export const MENTOR_USAGE_STATES = ["ok", "low", "exhausted", "resting", "none"] as const;
/**
 * ok: credits available. low: below max(10, 15% of current grant). exhausted: had
 * credits, below the admission bar of a new message (admit_min_credits). resting: global breaker (503). none: never had
 * credits (show the packages).
 */
export type MentorUsageState = (typeof MENTOR_USAGE_STATES)[number];

export type MentorAccessSource = "package" | "pro_included" | "trial" | "gift" | "admin" | "none";

export interface MentorUsageResponse {
  source?: MentorAccessSource;
  trial?: { credits: number; credits_left: number; expires_at: string; expired: boolean; pro_included_credits?: number; /** MUX-20: the lot is the one-time free taste (facts only), not the card trial. */ free_taste?: boolean };
  included_allowance?: { credits: number; credits_left: number; period_days: number; renews_at: string | null };
  state: MentorUsageState;
  /** Server-owned relative warning threshold, shared by all consumers. */
  low_threshold?: number;
  current_grant?: number;
  source_package?: MentorPackageId;
  renewal_at?: string | null;
  credits_left: number;
  /**
   * MUX-23: credits a new message needs before it may start, from the same
   * admission function the chat route uses (fresh facts question, no
   * history). null when it cannot be computed.
   */
  admit_min_credits?: number | null;
  messages_left_estimate: number;
  /** ISO time the soonest live lot expires, or null. */
  next_expiry: string | null;
  /** Where the user's current credits come from (for copy, never dollars). */
  sources: MentorAccessSource[];
  /** Active mentor subscriptions (renewing). */
  subscriptions: Array<{ package_id: MentorPackageId; renews: boolean; renews_at?: string | null; ends_at?: string | null; management_url?: string; status?: "active" | "ending" | "payment_failed" }>;
  /** Whether the packages page should be offered (MENTOR_PACKAGES_ENABLED and at least one buyable package). */
  can_buy: boolean;
  reason?: "paused";
  resting_until?: string | null;
  pending_purchase?: { package_id: MentorPackageOffer["package_id"]; since: string; checkout_session_id: string; retry_allowed: boolean } | null;
  recent_purchase?: { checkout_session_id: string; credits_added: number; granted_at: string } | null;
  /**
   * a-mentor-open: true when MENTOR_ACCESS_SCOPE (not the beta allowlist) let
   * this account in. Such accounts receive no included grants and spend only
   * lots they hold (purchases, referral credits). Absent otherwise.
   */
  credits_only?: true;
  /**
   * a-free-credit-hooks: every live lot is a free lot (tastes, welcome, codes,
   * rewards, gifts). The UI then offers packages only once the balance is low.
   */
  free_credits_only?: true;
  /** Credits a referrer earns when a referred person pays for the first time; present only while REFERRAL_MENTOR_CREDITS_ENABLED is on. */
  referral_credits?: number;
}

// ─── Packages (catalogue rows live in public.ai_credit_package) ─────────

/** Ids seeded by the migration. Numbers live in the DB row, never in code. */
export const MENTOR_PACKAGE_IDS = [
  "mentor_basis",
  "mentor_plus",
  "mentor_topup",
  "included_pro_monthly",
  "included_pro_quarterly",
  "included_cohort",
  "trial_taste",
  "gift_admin",
  "referral_reward",
  "included_admin",
  "included_unknown",
  "free",
  "free_taste",
  "beta_grant",
  // a-free-credit-hooks (20270102090000_a_free_credit_hooks.sql)
  "welcome_taste",
  "campaign_code",
  "experience_reward",
] as const;
export type MentorPackageId = (typeof MENTOR_PACKAGE_IDS)[number];

export const MENTOR_PACKAGE_KINDS = [
  "subscription",
  "topup",
  "included",
  "trial",
  "gift",
  "referral",
  "admin",
  "free",
  "unknown",
] as const;
export type MentorPackageKind = (typeof MENTOR_PACKAGE_KINDS)[number];

/** One public.ai_credit_package row as the server reads it. */
export interface CreditPackageRow {
  package_id: MentorPackageId;
  kind: MentorPackageKind;
  grant_micro: number;
  period_days: number | null;
  expiry_days: number;
  price_eur_cents: number | null;
  active: boolean;
  provisional: boolean;
  sort: number;
  note: string | null;
}

/** GET /api/mentor/packages item (buyable packages only). */
export interface MentorPackageOffer {
  package_id: "mentor_basis" | "mentor_plus" | "mentor_topup";
  kind: "subscription" | "topup";
  credits: number;
  messages_estimate: number;
  price_eur_cents: number;
  /** 30 for a monthly subscription; null for a top-up. */
  period_days: number | null;
  /** Days a top-up's credits stay valid; for subscriptions the period plus grace. */
  valid_days: number;
}

export interface MentorPackagesResponse {
  packages: MentorPackageOffer[];
}

export interface MentorCheckoutRequest {
  idempotency_key?: string;
  retry_pending?: boolean;
  /** a-tg-checkout-context: counts-only opener context (src/lib/checkout-context.ts). */
  context?: "tg_webapp" | "tg_inapp" | "pwa" | "browser";
  package_id: MentorPackageOffer["package_id"];
}

export interface MentorCheckoutResponse {
  purchase_url: string;
  checkout_session_id: string;
}

export interface MentorPurchaseReceipt {
  package_id: "mentor_basis" | "mentor_plus" | "mentor_topup";
  credits: number;
  expires_at: string;
  /** Immutable provider snapshot. null means no confirmed renewal date. */
  renews_at: string | null;
}
export interface MentorCheckoutVerifyResponse {
  status: "granted" | "pending" | "failed";
  /** MUX-84: why a failed purchase failed, only when the purchase row or the provider ledger shows it. */
  failure_reason?: "declined" | "refunded" | "needs_manual";
  credits_added: number;
  credits_left: number;
  receipt?: MentorPurchaseReceipt;
}

// ─── Lot sources and included-grant keys (ai_credit_lot.source) ─────────

export const CREDIT_LOT_SOURCES = [
  "whop_payment",
  "pro_included",
  "trial_taste",
  "admin_gift",
  "referral_reward",
  "admin_included",
  "unknown_included",
  "admin_adjust",
  "free_taste",
  "beta_grant",
  // a-free-credit-hooks (20270102090000_a_free_credit_hooks.sql)
  "welcome_taste",
  "campaign_code",
  "experience_reward",
] as const;
export type CreditLotSource = (typeof CREDIT_LOT_SOURCES)[number];

/**
 * Idempotency keys for included grants (lot source_id). One grant per key,
 * forever. W2-CREDITS builds them with these exact shapes:
 *   whop_payment      <pay_id>                         (one lot per Whop payment)
 *   pro_included      <subscription_id>:<slice>        slice = floor((now - started_at) / 30 days)
 *   trial_taste       <user_id>                        once per user, ever
 *   free_taste        <user_id>                        once per verified free user, ever
 *   beta_grant        <beta key>:<user_id>             once per user per beta cohort key
 *   welcome_taste     <user_id>                        once per account, ever (MENTOR_WELCOME_ENABLED)
 *   campaign_code     campaign:<user_id>               one code redemption per account, ever
 *   experience_reward testimonial:<user_id>            one testimonial thank-you per person
 *   referral_reward   trial_start:<referral_id>        referee started the card trial
 *   admin_gift        <subscription_id>:<slice>        admin-granted Pro
 *   referral_reward   <referral_id>
 *   admin_included    <user_id>:<YYYY-MM>             admin role, per UTC month
 *   unknown_included  <user_id>:<slice>               paid tier the table does not know
 *
 * Included lots expire at min(slice end, entitlement end): pass p_expires_at
 * explicitly so a Pro user who lapses or is refunded does not keep the rest
 * of the slice. Package lots (whop_payment) keep the package expiry_days.
 */
export function includedGrantKey(subscriptionOrUserId: string, slice: number): string {
  if (!Number.isInteger(slice) || slice < 0) throw new RangeError(`invalid slice ${slice}`);
  return `${subscriptionOrUserId}:${slice}`;
}

/** 30-day slice index of `now` within an entitlement that started at `startedAt`. */
export function entitlementSlice(startedAt: Date, now: Date): number {
  const ms = now.getTime() - startedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / (30 * 24 * 60 * 60 * 1000));
}

// ─── Whop integration contract (W2-CREDITS implements) ──────────────────

/**
 * Checkout metadata for a mentor package. NEVER carries a `tier` key, so the
 * Pro grant path can never mistake it for a Pro tier.
 */
export interface MentorCheckoutMetadata {
  kind: "mentor_credits";
  package: MentorPackageOffer["package_id"];
  medpruef_user_id: string;
}

export const MENTOR_CHECKOUT_METADATA_KIND = "mentor_credits" as const;

/** Events the mentor branch handles, by effect. Dot and underscore forms both accepted. */
export const MENTOR_WHOP_EVENTS = Object.freeze({
  grant: ["payment.succeeded", "payment_succeeded"],
  clawback: ["refund.created", "refund_created", "dispute.created", "dispute_created"],
  deactivate: ["membership.deactivated", "membership_deactivated", "membership.went_invalid", "membership_went_invalid"],
  /** Recorded only; Whop runs its own dunning for mentor plans in v1. */
  record_only: ["payment.failed", "payment_failed", "payment.requires_action", "payment_requires_action"],
} as const);

/**
 * How the branch recognises a MENTOR event, in order. It runs in the Whop
 * webhook AFTER the delivery is logged and BEFORE the revoke path, the
 * dunning path and the Pro grant path:
 *   1. data.metadata.kind === "mentor_credits"            (first payment)
 *   2. plan id in the MENTOR_WHOP_PLAN_ENV set             (no DB)
 *   3. mentor_whop_lookup(payment_id, membership_id)       (renewals: metadata is null;
 *                                                           refunds/disputes; deactivations)
 * A DB error in step 3 returns handled + 503 (Whop redelivers); it never falls
 * through to the Pro paths. Not recognised -> { handled: false } and the Pro
 * webhook continues exactly as before.
 *
 * WHERE THE IDS COME FROM (frozen; getting this wrong cancels the buyer's Pro
 * through the revoke fallback):
 *  - grant and record_only events: extractWhopPayment(data) from
 *    src/lib/whop.ts (paymentId, membershipId, metaUserId, planId, metadata).
 *  - clawback and deactivate events: extractWhopRevoke(data) and try EVERY
 *    candidate: paymentId, originalPaymentId, then membershipId. Never take a
 *    payment id from data.id on a non-payment event (on refund.created and
 *    dispute.created data.id is the refund or dispute id; on
 *    membership.deactivated it is the mem_ id).
 *  - refund and dispute kinds count as mentor ONLY on a matched payment id
 *    (a lot with source 'whop_payment'); a membership match alone is not
 *    enough to claw back. A deactivate counts on the membership pin.
 *  - Recognised but nothing to do (e.g. refund of an unknown mentor payment)
 *    -> handled, 200, action "unmapped", Sentry-flagged; never handleRevoke.
 */
export const MENTOR_WHOP_ID_RULES = Object.freeze({
  grant: { extractor: "extractWhopPayment", ids: ["paymentId", "membershipId"] },
  record_only: { extractor: "extractWhopPayment", ids: ["paymentId", "membershipId"] },
  clawback: { extractor: "extractWhopRevoke", ids: ["paymentId", "originalPaymentId"], requiresPaymentMatch: true },
  deactivate: { extractor: "extractWhopRevoke", ids: ["membershipId", "paymentId", "originalPaymentId"], requiresPaymentMatch: false },
} as const);
export type MentorWhopRecognition = "metadata" | "plan_id" | "ledger_payment" | "membership_pin";

export type MentorWhopDecision =
  | { handled: false }
  | {
      handled: true;
      status: 200 | 503;
      body: {
        ok: boolean;
        mentor: true;
        action: "granted" | "duplicate" | "clawed_back" | "deactivated" | "recorded" | "unmapped" | "retry";
        recognised_by?: MentorWhopRecognition;
        payment_id?: string | null;
      };
    };

/**
 * Hard rules for the branch (acceptance for W2-CREDITS):
 *  - A mentor event NEVER touches users.tier, subscriptions, or the Pro revoke
 *    fallback. A membership.deactivated on a mentor membership never cancels Pro.
 *  - Grant = mentor_grant_credits(user, package, 'whop_payment', payment_id, ...)
 *    with p_whop_membership_id so renewals are pinned. Idempotent on payment id.
 *  - Refund/dispute = mentor_revoke_payment(payment_id) for every payment id
 *    FIRST (tombstone: a grant that arrives later is refused, review H1), then
 *    mentor_clawback('whop_payment', payment_id): the unspent part is removed
 *    and the SPENT part becomes wallet debt (review H2).
 *  - A grant needs a real payment: amount > 0 and at least the package price
 *    less a VAT/fee tolerance (review H3).
 *  - An unmapped mentor payment (no user) is recorded for a manual grant and
 *    Sentry-flagged; it returns 200 so Whop stops retrying.
 *  - Inserted into src/app/api/webhooks/whop/route.ts as ONE call:
 *      const mentor = await routeMentorWhopEvent(event, data);
 *      if (mentor.handled) return NextResponse.json(mentor.body, { status: mentor.status });
 *    placed after the webhook_received logPaymentEvent and before classifyWhopRevoke.
 */
export type RouteMentorWhopEvent = (event: string, data: unknown) => Promise<MentorWhopDecision>;

// ─── SQL RPCs (20261022100000_mentor_ledger.sql; service_role only) ─────

/**
 * Frozen RPC names and argument names. Every RPC returns jsonb with `ok`
 * (except mentor_whop_lookup / mentor_balance, which raise on error) and
 * never throws from inside for business outcomes. Callers treat any
 * transport error or unparseable body as ok=false (fail closed).
 */
export const MENTOR_RPCS = Object.freeze({
  reserve: { fn: "mentor_reserve", args: ["p_user", "p_request", "p_call_index", "p_ceiling_micro"] },
  settleInput: { fn: "mentor_settle_input", args: ["p_request", "p_call_index", "p_input_micro"] },
  settle: { fn: "mentor_settle", args: ["p_request", "p_call_index", "p_actual_micro", "p_usage", "p_bill_user"] },
  release: { fn: "mentor_release", args: ["p_request", "p_call_index"] },
  sweepStale: { fn: "mentor_sweep_stale", args: ["p_older_than"] },
  grantCredits: {
    fn: "mentor_grant_credits",
    args: [
      "p_user",
      "p_package",
      "p_source",
      "p_source_id",
      "p_micro",
      "p_starts_at",
      "p_expires_at",
      "p_whop_payment_id",
      "p_whop_membership_id",
    ],
  },
  clawback: { fn: "mentor_clawback", args: ["p_source", "p_source_id", "p_reason"] },
  /** Tombstone for a refunded/disputed payment; a later grant of it is refused (reason "revoked"). */
  revokePayment: { fn: "mentor_revoke_payment", args: ["p_payment_id", "p_event"] },
  membershipStatus: { fn: "mentor_membership_status", args: ["p_membership_id", "p_status"] },
  whopLookup: { fn: "mentor_whop_lookup", args: ["p_payment_id", "p_membership_id"] },
  balance: { fn: "mentor_balance", args: ["p_user"] },
  attemptTake: { fn: "mentor_attempt_take", args: ["p_user", "p_per_min", "p_per_day"] },
  houseFailTake: { fn: "mentor_house_fail_take", args: ["p_user", "p_limit"] },
  spendMonth: { fn: "ai_spend_month", args: ["p_month"] },
  spendCap: { fn: "ai_spend_cap", args: ["p_floor_micro", "p_net_pct"] },
} as const);

// ─── Admin cost view (W3-COSTVIEW; GET /api/mentor/admin/summary, requireAdmin) ─

/** Read-only. Ids only, never emails. Money here is micro-USD (admin only). */
export interface MentorAdminSummary {
  timezone?: "UTC" | "Europe/Vienna";
  projection?: { projected_month_micro: number; cap_in_days: number | null };
  quality?: MentorQualitySummary;
  generated_at: string;
  /** UTC month YYYY-MM the totals cover. */
  month: string;
  spend: {
    mentor_micro: number;
    legacy_micro: number;
    /** ai_spend_month(month): mentor + legacy Anthropic. */
    total_micro: number;
    /** ai_spend_cap(floor, pct) with the config values. */
    cap_micro: number;
    pct_of_cap: number;
    /**
     * MUX-106 A: each lane's share of cap_micro (they add up to it). With
     * split_caps false the a38 split read is not installed and the breaker
     * still compares total_micro with cap_micro.
     */
    split_caps?: boolean;
    mentor_cap_micro?: number;
    legacy_cap_micro?: number;
    mentor_pct_of_cap?: number;
    legacy_pct_of_cap?: number;
  };
  by_day: Array<{ day: string; mentor_micro: number; calls: number; house_micro: number }>;
  by_model: Array<{ model: string; mentor_micro: number; calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number }>;
  top_users: Array<{ user_id: string; spent_micro: number; messages: number; available_micro: number }>;
  /** Open reservations older than RESERVE_STALE_MINUTES (stuck holds). */
  stale_reservations: Array<{ request_id: string; call_index: number; user_id: string; ceiling_micro: number; age_minutes: number }>;
  lots_by_package: Array<{ package_id: MentorPackageId; lots: number; granted_micro: number; spent_micro: number; clawed_back_micro: number; live_remaining_micro: number }>;
  clawbacks: Array<{ lot_id: string; user_id: string; package_id: MentorPackageId; clawed_micro: number; at: string }>;
  overruns: number;
  debt_total_micro: number;
  state: {
    ai_features_enabled: boolean;
    mentor_enabled: boolean;
    packages_enabled: boolean;
    topups_enabled: boolean;
    /** DB flag 'mentor' row (enabled, env, rollout_pct) or null. */
    db_flag: { enabled: boolean; env: string; rollout_pct: number } | null;
    /** Global breaker tripped (total >= cap). */
    resting: boolean;
    beta_allowlist_size: number;
  };
}

export const MENTOR_REPORT_REASONS = ["date_wrong", "rule_wrong", "explanation_unclear", "question_wrong", "other"] as const;
export type MentorReportReason = typeof MENTOR_REPORT_REASONS[number];
export const MENTOR_TURN_OUTCOMES = ["answered", "refused", "replaced_partial", "notice_only", "error", "blocked_402", "blocked_429", "blocked_cap"] as const;
export type MentorTurnOutcome = typeof MENTOR_TURN_OUTCOMES[number];
export interface MentorQualitySummary {
  by_day: Array<{ day: string; outcomes: Record<MentorTurnOutcome, number> }>;
  replaced_pct: number; error_pct: number;
  replaced_amber: boolean; error_amber: boolean;
  p50_latency_ms: number; p95_latency_ms: number;
  cost_per_message_micro: number;
  cold_cache_share_pct: number;
  messages_per_payer: number;
  answers_by_language: Record<string, number>;
}
