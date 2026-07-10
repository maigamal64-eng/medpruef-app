/**
 * Case-runner for scripts/test_referral_reward_offstate.mjs — see that
 * file's header for the full rationale. This is a permanent fixture
 * (not a temp file), imported/spawned via `npx tsx` so it can resolve
 * the real `@/lib/referral-exam-reward` module + its `@/*` alias.
 *
 * Reads TEST_CASE_NAME from env (just an echo label in the output),
 * and REFERRAL_EXAM_REWARD_ENABLED is read by the module under test
 * itself (this file never touches that env var — the harness sets it
 * before spawning this process, proving the gate is read from real
 * process.env, not injected as a function argument).
 */

import {
  qualifyReferralOnActivity,
  flagReferrerForRewardReview,
  grantExamRewardToReferrer,
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
  const state: { users: Record<string, Row>; referrals: Record<string, Row> } = {
    users: {
      [REFEREE_ID]: {
        id: REFEREE_ID,
        referred_by_code: "ABCD1234",
        active_exam: "kenntnispruefung",
      },
      [REFERRER_ID]: {
        id: REFERRER_ID,
        active_exam: "kenntnispruefung",
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
        reward_type: "cash",
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
  };

  function table(name: "users" | "referrals" | "answer_history") {
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

async function runCase(caseName: string) {
  const sb: any = makeMock();
  mutations.length = 0;

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

  console.log(
    JSON.stringify({
      case: caseName,
      rowFlipped,
      anyMutationFired: mutations.length > 0,
      anyMutationFiredAfterQualify,
      enqueued,
      grantResult,
      tierGranted,
      mutationCount: mutations.length,
    })
  );
}

await runCase(process.env.TEST_CASE_NAME || "unnamed");
