/**
 * Mentor API fixtures (contract C4, frozen by W0-C0B-MENTOR on 2026-10-10).
 *
 * Realistic responses for W2-UI to build against before W2-CORE merges, and
 * for contract tests. Every fact, label and link here is SYNTHETIC: the
 * example.org sources and "Beispiel" labels must never ship as real content.
 * No exam date or fee appears in any fixture text (C14). No em dashes.
 */

import type {
  MentorCheckoutResponse,
  MentorCheckoutVerifyResponse,
  MentorErrorBody,
  MentorErrorCode,
  MentorFinalEvent,
  MentorPackagesResponse,
  MentorSseEvent,
  MentorUsageResponse,
  MentorUsageState,
} from "./contract";
import { MENTOR_ERROR_STATUS } from "./contract";

const SYNTH_EXPIRY = "2099-01-31T00:00:00.000Z"; // date-ok: synthetic fixture timestamp, not an exam claim

const CITATION_A = {
  fact_id: "fixture.registration.portal",
  source_label: "Beispielquelle, Merkblatt",
  source_url: "https://example.org/mentor-fixture/merkblatt",
  read_on: "2026-10-10",
} as const;

const CITATION_B = {
  fact_id: "fixture.format.mcq",
  source_label: "Beispielquelle, Prüfungsordnung",
  source_url: "https://example.org/mentor-fixture/pruefungsordnung",
  read_on: "2026-10-10",
} as const;

export const FIXTURE_FINAL_OK: MentorFinalEvent = {
  type: "final",
  conversation_id: "00000000-0000-4000-8000-00000000c0a1",
  answer_blocks: [
    {
      text: "Die Anmeldung läuft über das Online-Portal der Universität, bei der Sie Ihre Nostrifizierung eingereicht haben. Wo haben Sie eingereicht: Wien, Graz oder Innsbruck?",
      fact_ids: [CITATION_A.fact_id],
    },
    {
      text: "Die Prüfung besteht aus Multiple-Choice-Fragen. Die genaue Bestehensregel steht in der Prüfungsordnung.",
      fact_ids: [CITATION_B.fact_id],
    },
  ],
  citations: [CITATION_A, CITATION_B],
  credits_left: 142,
  messages_left_estimate: 140,
};

export const FIXTURE_FINAL_REFUSED: MentorFinalEvent = {
  type: "final",
  conversation_id: "00000000-0000-4000-8000-00000000c0a2",
  answer_blocks: [
    {
      text: "Ob Ihr Diplom anerkannt wird, entscheidet nur die Universität in Ihrem Verfahren. Bitte fragen Sie dort direkt nach.",
      fact_ids: [],
    },
  ],
  citations: [],
  refused: "individual_ruling",
  refusal_link: "https://example.org/mentor-fixture/kontakt",
  credits_left: 141,
  messages_left_estimate: 139,
};

export const FIXTURE_FINAL_VALIDATOR: MentorFinalEvent = {
  ...FIXTURE_FINAL_OK,
  conversation_id: "00000000-0000-4000-8000-00000000c0a3",
  answer_blocks: [
    {
      text: "Diesen Wert konnte ich nicht in einer offiziellen Quelle bestätigen. Bitte prüfen Sie ihn auf der offiziellen Seite.",
      fact_ids: [],
    },
  ],
  citations: [CITATION_A],
  validator_replaced: true,
};

/** Production validates before display: status dots followed by one final burst. */
export const FIXTURE_STREAM_OK: MentorSseEvent[] = [
  { type: "status", phase: "checking_sources" },
  { type: "status", phase: "writing" },
  FIXTURE_FINAL_OK,
];
export const FIXTURE_STREAM_REFUSED: MentorSseEvent[] = [
  { type: "status", phase: "writing" }, FIXTURE_FINAL_REFUSED,
];
/** Legacy export name retained. Partial answer text before error is unreachable. */
export const FIXTURE_STREAM_MIDWAY_ERROR: MentorSseEvent[] = [
  { type: "status", phase: "checking_sources" },
  { type: "error", error: "upstream_error" },
];
export const FIXTURE_EXPLAIN_ANSWERED: MentorFinalEvent = {
  ...FIXTURE_FINAL_OK, question_id: 1,
  answer_blocks: [{ text: "Die Beispielfrage prüft den Unterschied zwischen Befund und Diagnose.", fact_ids: [], explain_layer: "grounded" }], citations: [],
};
export const FIXTURE_EXPLAIN_UNANSWERED: MentorFinalEvent = {
  ...FIXTURE_EXPLAIN_ANSWERED,
  answer_blocks: [{ text: "Achten Sie zuerst darauf, welche Information der Befund liefert.", fact_ids: [], explain_layer: "grounded" }],
};

function usage(state: MentorUsageState, credits: number, extra: Partial<MentorUsageResponse> = {}): MentorUsageResponse {
  return {
    state,
    credits_left: credits,
    messages_left_estimate: credits,
    next_expiry: credits > 0 ? SYNTH_EXPIRY : null,
    sources: credits > 0 ? ["package"] : ["none"],
    subscriptions: credits > 0 ? [{ package_id: "mentor_basis", renews: true }] : [],
    can_buy: true,
    ...extra,
  };
}

export const FIXTURE_USAGE: Readonly<Record<MentorUsageState, MentorUsageResponse>> = Object.freeze({
  ok: usage("ok", 142),
  low: usage("low", 12),
  exhausted: usage("exhausted", 0, { sources: ["package"], subscriptions: [{ package_id: "mentor_basis", renews: true }] }),
  resting: usage("resting", 142, { can_buy: false }),
  none: usage("none", 0),
});

/** A Pro user funded by the included grant and a trial user on the taste. */
export const FIXTURE_USAGE_PRO_INCLUDED: MentorUsageResponse = usage("ok", 50, {
  included_allowance: { credits: 50, credits_left: 50, period_days: 30, renews_at: SYNTH_EXPIRY },
  sources: ["pro_included"],
  subscriptions: [],
});
export const FIXTURE_USAGE_TRIAL: MentorUsageResponse = usage("ok", 20, { sources: ["trial"], subscriptions: [] });

export const FIXTURE_ERRORS: Readonly<Record<MentorErrorCode, { status: number; body: MentorErrorBody }>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(MENTOR_ERROR_STATUS) as MentorErrorCode[]).map((code) => {
      const body: MentorErrorBody = { error: code };
      if (code === "rate_limited") body.retry_after_seconds = 30;
      if (code === "credits_required" || code === "credits_exhausted") body.packages_url = "/mentor/packages";
      return [code, { status: MENTOR_ERROR_STATUS[code], body }];
    }),
  ) as Record<MentorErrorCode, { status: number; body: MentorErrorBody }>,
);

/** Synthetic offer numbers for layout only; the real ones come from ai_credit_package rows. */
export const FIXTURE_PACKAGES: MentorPackagesResponse = {
  packages: [
    { package_id: "mentor_basis", kind: "subscription", credits: 150, messages_estimate: 150, price_eur_cents: 490, period_days: 30, valid_days: 33 },
    { package_id: "mentor_plus", kind: "subscription", credits: 400, messages_estimate: 400, price_eur_cents: 990, period_days: 30, valid_days: 33 },
    { package_id: "mentor_topup", kind: "topup", credits: 400, messages_estimate: 400, price_eur_cents: 1000, period_days: null, valid_days: 180 },
  ],
};

export const FIXTURE_CHECKOUT: MentorCheckoutResponse = {
  checkout_session_id: "55555555-5555-4555-8555-555555555555",
  purchase_url: "https://example.org/mentor-fixture/checkout?session=ch_fixture",
};

export const FIXTURE_CHECKOUT_VERIFY: Readonly<Record<MentorCheckoutVerifyResponse["status"], MentorCheckoutVerifyResponse>> =
  Object.freeze({
    granted: { status: "granted", credits_added: 150, credits_left: 150, receipt: { package_id: "mentor_basis", credits: 150, expires_at: SYNTH_EXPIRY, renews_at: "2099-01-28T00:00:00.000Z" } },
    pending: { status: "pending", credits_added: 0, credits_left: 0 },
    failed: { status: "failed", credits_added: 0, credits_left: 0 },
  });

/** Each scenario is a reachable server response. Availability 429 retains last-known state. */
export const FIXTURE_CAPTURE_STATES = ["ok", "low", "exhausted", "pro", "trial", "resting", "nopackages", "grantpay", "slowpay", "failpay", "explain-answered", "explain-unanswered", "entry429-hidden", "entry429-retained", "breaker-composing", "facts-due", "readiness-red", "review-queue"] as const;
export const FIXTURE_ENTRY_429 = { status: 429, body: { error: "rate_limited", retry_after_seconds: 30 }, last_known_hidden: "hidden", last_known_retained: "available" } as const;
export const FIXTURE_OPERATIONS = {
  generated_at: "2026-10-11T12:00:00.000Z", breaker: { floor_micro: 50000000, net_pct: 6, resting_until: "2026-11-01T00:00:00.000Z" },
  facts: { total: 1, assertable: 1, due_7_days: 1, due_3_days: 1, expired: 0, oldest_read_on: "2026-10-01", errors: [], soonest: [{ id: "fixture.registration.portal", read_on: "2026-10-01", due_on: "2026-10-13", source_url: "https://example.org/mentor-fixture/merkblatt", owner_file: "content/mentor-facts/fixture.json", status: "Due" }] },
  checks: ["migration", "flags", "plans", "eval", "native_review", "sweep"].map(key => ({ key, label: key, ok: false, detail: "Synthetic unmet release gate", fix: "track-A must provide real acceptance evidence" })),
  last_turn: null, last_sweep: null, last_whop_event: null, last_eval: null,
};
export const FIXTURE_REVIEW_QUEUE = { items: [{ request_id: "00000000-0000-4000-8000-00000000c0a1", category: "report", conversation_id: FIXTURE_FINAL_OK.conversation_id, question_text: "Wie melde ich mich an?", answer_text: FIXTURE_FINAL_OK.answer_blocks.map(b => b.text).join("\n\n"), citations: FIXTURE_FINAL_OK.citations, lang: "de", outcome: "success", verdict: null, created_at: "2026-10-11T12:00:00.000Z" }] };

export const FIXTURE_ADMIN_QUALITY = {
  month: "2026-10", timezone: "Europe/Vienna", generated_at: "2026-10-11T12:00:00.000Z",
  quality: { by_day: [], replaced_pct: 6, error_pct: 3, replaced_amber: true, error_amber: true, p50_latency_ms: 1200, p95_latency_ms: 3000, cost_per_message_micro: 1800, cold_cache_share_pct: 10, messages_per_payer: 2, answers_by_language: { de: 1, en: 1 } },
};
