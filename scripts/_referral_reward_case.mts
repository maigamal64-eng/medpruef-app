/**
 * Case-runner for scripts/test_referral_reward_offstate.mjs — see that
 * file's header for the full rationale. This is a permanent fixture
 * (not a temp file), imported/spawned via `npx tsx` so it can resolve
 * the real `@/lib/referral-exam-reward` module + its `@/*` alias.
 *
 * Reads TEST_CASE_NAME from env (just an echo label in the output).
 * REFERRAL_EXAM_REWARD_ENABLED and REFERRAL_REQUIRE_CARD_TRIAL are read
 * by the module under test itself (this file never touches them —
 * the harness sets them before spawning this process, proving the
 * gates are read from real process.env, not injected as arguments).
 *
 * NO_ACTIVE_EXAM=1 selects the stuck-queue-no-op scenario (2026-07-11
 * fix): the referrer fixture has active_exam=null, so
 * grantExamRewardToReferrer's terminal no-op branch fires and must
 * resolve the queue entry (stamp hold_reason away from
 * 'exam_reward_pending_review') instead of leaving it stuck forever.
 *
 * CARD_TRIAL_FIXTURE selects the referee's subscriptions-table fixture
 * for the card-gate tests (2026-07-11 tightening):
 *   'none'      — no subscriptions row at all (referee never trialed)
 *   'card'      — active Whop card-rail row (payment_provider='whop',
 *                 payment_method='card', status='active') — the real
 *                 qualifying signal
 *   'legacy'    — the legacy no-card regression row
 *                 (tier='notes_free_trial', payment_provider='trial',
 *                 payment_method='telegram_trial', status='active') —
 *                 must NOT satisfy the gate on any axis
 * Defaults to 'card' so the pre-existing ON/stuck-queue scenarios keep
 * passing unchanged when this var isn't set.
 */

import {
  qualifyReferralOnActivity,
  flagReferrerForRewardReview,
  grantExamRewardToReferrer,
  isReferralExamRewardEnabled,
} from "@/lib/referral-exam-reward";

const REFEREE_ID = "22222222-2222-2222-2222-222222222222";
const REFERRER_ID = "11111111-1111-1111-1111-111111111111";
const PENDING_ROW_ID = "33333333-3333-3333-3333-333333333333";
const PRIOR_QUALIFIED_ROW_ID = "44444444-4444-4444-4444-444444444444";

// 20 distinct questions, 2 distinct UTC days — the qualifying dataset.
const ANSWER_HISTORY = [
  ...Array.from({ length: 12 }, (_, i) => ({
    user_id: REFEREE_ID,
    question_id: i + 1,
    created_at: "2026-07-01T09:00:00.000Z",
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    user_id: REFEREE_ID,
    question_id: i + 100,
    created_at: "2026-07-02T09:00:00.000Z",
  })),
];

const mutations: Array<{ table: string; type: string; patch: unknown; filters: unknown[] }> = [];

type Row = Record<string, unknown>;

function makeMock() {
  // NO_ACTIVE_EXAM=1 selects the stuck-queue-no-op scenario: the
  // referrer has no active_exam, so grantExamRewardToReferrer's
  // no_active_exam branch fires instead of a real grant.
  const referrerActiveExam = process.env.NO_ACTIVE_EXAM === "1" ? null : "kenntnispruefung";

  const state: {
    users: Record<string, Row>;
    referrals: Record<string, Row>;
    subscriptions: Record<string, Row>;
  } = {
    users: {
      [REFEREE_ID]: {
        id: REFEREE_ID,
        referred_by_code: "ABCD1234",
        active_exam: "kenntnispruefung",
      },
      [REFERRER_ID]: {
        id: REFERRER_ID,
        active_exam: referrerActiveExam,
        tier: "free",
        tier_expires_at: null,
      },
    },
    referrals: {
      [PENDING_ROW_ID]: {
        id: PENDING_ROW_ID,
        referrer_user_id: REFERRER_ID,
        referee_user_id: REFEREE_ID,
        status: "pending",
        // PENDING_ROW_REWARD_TYPE (2026-07-11 ordering-race scenario):
        // a row created under the active exam-reward program is
        // stamped 'pro_until_exam' at claim time (src/app/api/
        // referrals/claim/route.ts), not left at the 'cash' column
        // default. Defaults to 'cash' so the pre-existing scenarios
        // (which model a legacy row) keep passing unchanged.
        reward_type: process.env.PENDING_ROW_REWARD_TYPE || "cash",
        hold_reason: null,
        created_at: "2026-06-25T00:00:00.000Z",
      },
      [PRIOR_QUALIFIED_ROW_ID]: {
        id: PRIOR_QUALIFIED_ROW_ID,
        referrer_user_id: REFERRER_ID,
        referee_user_id: "55555555-5555-5555-5555-555555555555",
        status: "qualified",
        reward_type: "pro_until_exam",
        hold_reason: null,
        created_at: "2026-06-20T00:00:00.000Z",
        qualified_at: "2026-06-21T00:00:00.000Z",
      },
    },
    subscriptions: {},
  };

  // Card-gate fixture (2026-07-11 tightening). Default 'card' so the
  // pre-card-gate scenarios (ON, stuck-queue) keep exercising the real
  // qualifying path unchanged when this var isn't explicitly set.
  const cardFixture = process.env.CARD_TRIAL_FIXTURE || "card";
  if (cardFixture === "card") {
    state.subscriptions["sub-card-1"] = {
      id: "sub-card-1",
      user_id: REFEREE_ID,
      tier: "notes_pro_trial",
      status: "active",
      payment_provider: "whop",
      payment_method: "card",
      started_at: "2026-07-01T08:00:00.000Z",
    };
  } else if (cardFixture === "legacy") {
    // The legacy no-card regression row (2026-07-04..09 window,
    // MEDPRUF-SOT.md §10.2): must fail the gate on provider AND method,
    // not just tier.
    state.subscriptions["sub-legacy-1"] = {
      id: "sub-legacy-1",
      user_id: REFEREE_ID,
      tier: "notes_free_trial",
      status: "active",
      payment_provider: "trial",
      payment_method: "telegram_trial",
      started_at: "2026-07-04T08:00:00.000Z",
    };
  }
  // cardFixture === "none": no subscriptions row at all.

  function table(name: "users" | "referrals" | "answer_history" | "subscriptions") {
    return {
      select() {
        const filters: Array<[string, unknown]> = [];
        const inFilters: Array<[string, unknown[]]> = [];
        const builder: any = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return builder;
          },
          in(col: string, vals: unknown[]) {
            inFilters.push([col, vals]);
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          async maybeSingle() {
            const rows = Object.values((state as any)[name] || {}).filter((row: any) =>
              filters.every(([c, v]) => row[c] === v)
            );
            return { data: rows[0] || null, error: null };
          },
          then(resolve: (v: { data: unknown; error: null }) => void) {
            // answer_history is special-cased: countDistinctAnsweredInExam
            // (src/lib/free-tier.ts) selects with a `questions!inner(...)`
            // embed and filters on the JOINED columns (questions.exam_type,
            // questions.is_active), which this flat mock doesn't model as
            // a real join. qualifyReferralOnActivity's own second query
            // filters only on user_id for the distinct-day count. Both
            // call sites only ever need user_id-level filtering to behave
            // correctly for this fixture, so we filter ONLY on keys that
            // exist on the fixture rows and ignore unknown join-path keys
            // -- that mirrors "the join matched" without reimplementing
            // PostgREST embed semantics.
            if (name === "answer_history") {
              const knownKeys = new Set(["user_id", "question_id", "created_at"]);
              let rows = ANSWER_HISTORY.filter((row) =>
                filters.filter(([c]) => knownKeys.has(c)).every(([c, v]) => (row as any)[c] === v)
              );
              for (const [c, vals] of inFilters) {
                if (knownKeys.has(c)) rows = rows.filter((row) => vals.includes((row as any)[c]));
              }
              resolve({ data: rows, error: null });
              return;
            }
            let rows = Object.values((state as any)[name] || {}).filter((row: any) =>
              filters.every(([c, v]) => row[c] === v)
            );
            for (const [c, vals] of inFilters) {
              rows = rows.filter((row: any) => vals.includes(row[c]));
            }
            resolve({ data: rows, error: null });
          },
        };
        return builder;
      },
      update(patch: Row) {
        const filters: Array<[string, unknown]> = [];
        const builder: any = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return builder;
          },
          then(resolve: (v: { data: unknown; error: null }) => void) {
            mutations.push({ table: name, type: "update", patch, filters });
            const rows = Object.values((state as any)[name] || {}).filter((row: any) =>
              filters.every(([c, v]) => row[c] === v)
            );
            for (const row of rows) Object.assign(row as object, patch);
            resolve({ data: rows, error: null });
          },
        };
        return builder;
      },
    };
  }

  return { from: table, state };
}

/**
 * Faithful port of the two guard clauses that close the 2026-07-11
 * ordering race in qualifyReferralOnWhopPayment
 * (src/app/api/webhooks/whop/route.ts). Not the full function (payout
 * calc / annual cap / self-referral checks are irrelevant to the race
 * this test proves) — only the two checks that decide whether the
 * legacy cash qualifier is even allowed to touch a row:
 *   1. no-op immediately if the exam-reward program is active
 *   2. no-op if the pending row's reward_type isn't 'cash'
 * The route file's function itself cannot be imported here (Next.js
 * forbids arbitrary named exports from an app/api/*\/route.ts file —
 * confirmed by tsc when this was attempted), so this port stands in;
 * keeping it in the same file as the scenario that exercises it makes
 * any future drift from the real function's guard logic visible in
 * code review.
 */
async function legacyCashQualifierWouldTouchRow(
  sb: any,
  referrerId: string,
  refereeId: string
): Promise<boolean> {
  if (isReferralExamRewardEnabled()) return false;
  const { data: existing } = await sb
    .from("referrals")
    .select("id, status, reward_type")
    .eq("referrer_user_id", referrerId)
    .eq("referee_user_id", refereeId)
    .maybeSingle();
  if (!existing) return true; // would insert a new cash row
  if (existing.status !== "pending") return false;
  if (existing.reward_type && existing.reward_type !== "cash") return false;
  return true;
}

async function runCase(caseName: string) {
  const sb: any = makeMock();
  mutations.length = 0;

  // Ordering scenario (2026-07-11 race fix): mirrors the real webhook
  // call order in src/app/api/webhooks/whop/route.ts — the legacy cash
  // qualifier runs FIRST, then the exam-reward qualifier. Run the
  // ported guard check here (read-only, does not mutate) so the result
  // reflects whether the CURRENT state at this point in the sequence
  // would have let the legacy function touch the row.
  const legacyWouldTouchBeforeExamQualify = await legacyCashQualifierWouldTouchRow(
    sb,
    REFERRER_ID,
    REFEREE_ID
  );

  await qualifyReferralOnActivity(sb, REFEREE_ID);

  const pendingRowAfter = sb.state.referrals[PENDING_ROW_ID];
  const rowFlipped = pendingRowAfter.status === "qualified";
  const anyMutationFiredAfterQualify = mutations.length > 0;

  await flagReferrerForRewardReview(sb, REFERRER_ID);
  const enqueued =
    pendingRowAfter.hold_reason === "exam_reward_pending_review" ||
    sb.state.referrals[PRIOR_QUALIFIED_ROW_ID].hold_reason === "exam_reward_pending_review";

  const grantResult = await grantExamRewardToReferrer(sb, REFERRER_ID);
  const referrerAfter = sb.state.users[REFERRER_ID];
  const tierGranted = referrerAfter.tier === "pro";

  // Stuck-queue check (2026-07-11 fix): after a no-op grant attempt, no
  // row for this referrer should still carry the LIVE
  // 'exam_reward_pending_review' hold_reason — it must have resolved to
  // a terminal value, or the admin queue would show this referrer
  // forever with a Grant button that always no-ops.
  const stillPendingReview =
    pendingRowAfter.hold_reason === "exam_reward_pending_review" ||
    sb.state.referrals[PRIOR_QUALIFIED_ROW_ID].hold_reason === "exam_reward_pending_review";
  const queueResolved = enqueued && !stillPendingReview;

  console.log(
    JSON.stringify({
      case: caseName,
      rowFlipped,
      anyMutationFired: mutations.length > 0,
      anyMutationFiredAfterQualify,
      enqueued,
      grantResult,
      tierGranted,
      queueResolved,
      mutationCount: mutations.length,
      legacyWouldTouchBeforeExamQualify,
    })
  );
}

await runCase(process.env.TEST_CASE_NAME || "unnamed");
