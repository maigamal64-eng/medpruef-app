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
  source_label: "Beispielquelle (Fixture), Merkblatt",
  source_url: "https://example.org/mentor-fixture/merkblatt",
  read_on: "2026-10-10",
} as const;

const CITATION_B = {
  fact_id: "fixture.format.mcq",
  source_label: "Beispielquelle (Fixture), Prüfungsordnung",
  source_url: "https://example.org/mentor-fixture/pruefungsordnung",
  read_on: "2026-10-10",
} as const;

export const FIXTURE_FINAL_OK: MentorFinalEvent = {
  type: "final",
  conversation_id: "00000000-0000-4000-8000-00000000c0a1",
  answer_blocks: [
    {
      text: "Die Anmeldung läuft ueber das Online-Portal der Universität, bei der du deine Nostrifizierung eingereicht hast. Wo hast du eingereicht: Wien, Graz oder Innsbruck?",
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
      text: "Ob dein Diplom anerkannt wird, entscheidet nur die Universität in deinem Verfahren. Bitte frag dort direkt nach.",
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
      text: "Diesen Wert konnte ich nicht in einer offiziellen Quelle bestätigen. Bitte prüf ihn auf der offiziellen Seite.",
      fact_ids: [],
    },
  ],
  citations: [CITATION_A],
  validator_replaced: true,
};

/** A full streamed answer: deltas, then the final event. */
export const FIXTURE_STREAM_OK: MentorSseEvent[] = [
  { type: "delta", text: "Die Anmeldung läuft ueber das Online-Portal " },
  { type: "delta", text: "der Universität, bei der du deine Nostrifizierung eingereicht hast. " },
  { type: "delta", text: "Wo hast du eingereicht: Wien, Graz oder Innsbruck?" },
  FIXTURE_FINAL_OK,
];

export const FIXTURE_STREAM_REFUSED: MentorSseEvent[] = [
  { type: "delta", text: "Ob dein Diplom anerkannt wird, entscheidet nur die Universität in deinem Verfahren." },
  FIXTURE_FINAL_REFUSED,
];

/** The stream started, then an upstream failure ended it. */
export const FIXTURE_STREAM_MIDWAY_ERROR: MentorSseEvent[] = [
  { type: "delta", text: "Die Anmeldung läuft ueber " },
  { type: "error", error: "upstream_error" },
];

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
  resting: usage("resting", 142),
  none: usage("none", 0),
});

/** A Pro user funded by the included grant and a trial user on the taste. */
export const FIXTURE_USAGE_PRO_INCLUDED: MentorUsageResponse = usage("ok", 200, {
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
  purchase_url: "https://example.org/mentor-fixture/checkout?session=ch_fixture",
};

export const FIXTURE_CHECKOUT_VERIFY: Readonly<Record<MentorCheckoutVerifyResponse["status"], MentorCheckoutVerifyResponse>> =
  Object.freeze({
    granted: { status: "granted", credits_left: 150 },
    pending: { status: "pending", credits_left: 0 },
    failed: { status: "failed", credits_left: 0 },
  });
