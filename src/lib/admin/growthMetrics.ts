/**
 * growthMetrics — the GROWTH FUNNEL behind /admin/growth (Autonomy Control
 * Plane, AUTONOMY.md F-08). The reach/funnel counterpart to controlPlaneMetrics:
 * control-plane owns EUROS (MRR, conversion, churn, LTV); growth owns the
 * top-of-funnel SHAPE — how many real people sign up, activate, get engaged,
 * and (the one number both panels share) pay.
 *
 * The funnel is signups → activated → engaged → paying, each step a count plus
 * its percentage of signups, so the drop-off between stages is visible.
 *
 * REAL-USER + PAYING DEFINITIONS (a14, 2026-10-12): owned by ./money-rules and
 * shared with Overview, Payments, the paid roster and the control plane:
 *   - signups   = real users = all accounts minus staff and test accounts
 *                 (isStaffOrTestAccount). Telegram-only accounts have no email
 *                 and stay counted.
 *   - activated = real users with >= 1 answer_history row.
 *   - engaged   = real users with >= 25 answer_history rows.
 *   - paying    = distinct real learners with an active, unexpired real-rail
 *                 subscription AND a positive payment (classifyPayers). A trial
 *                 without a charge is in trial, not paying.
 *
 * ── HOW "engaged" IS COUNTED WITHOUT THE 1000-ROW REST CAP (the method the
 *    task asks to be documented) ──────────────────────────────────────────────
 * answer_history is large and skewed: confirmed on prod (2026-06-23, the
 * 20260623120000_topic_progress_aggregates migration) there are 75 users with
 * answers and 4 of them exceed 1000 rows (1557 / 1508 / 1407 / 1203). A bare
 * `sb.from('answer_history').select('user_id')` is silently capped at 1000 rows
 * server-side (the standing PostgREST ceiling that get_topic_counts /
 * get_user_topic_stats / get_user_topic_progress all exist to dodge), so
 * grouping by user in JS would undercount the heavy users and mis-bucket who is
 * "engaged".
 *
 * We therefore use a COUNT-BASED approach, never a row fetch: for each REAL user
 * we issue a HEAD count (`select('id', { count: 'exact', head: true })`) of
 * their answer_history rows. A head count returns only the integer — no rows,
 * so the 1000-row cap is irrelevant and the number is exact at any size. One
 * pass yields both tiers (>=1 ⇒ activated, >=25 ⇒ engaged). This is the same
 * count-based escape the task sanctions ("a count-based approach OR an RPC like
 * get_user_topic_stats if present"); no such global per-user-total RPC exists,
 * and adding a migration is out of scope for this build, so the per-user head
 * count is the robust no-migration path.
 *
 * Tradeoff (documented, accepted at current scale): this is O(real users) round
 * trips (114 today). We chunk them (CHUNK_SIZE at a time) so we never open 114
 * concurrent connections on the service-role pool. If the user base grows into
 * the thousands, replace this loop with a single grouped RPC
 * (`SELECT user_id, count(*) FROM answer_history GROUP BY user_id HAVING ...`,
 * mirroring the get_user_topic_stats convention) — at that point the migration
 * is warranted. READ-ONLY throughout: every query here is a SELECT/count.
 */

import { assertReadSucceeded } from "./read-result";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsById, loadAccounts, loadLedger, loadSubscriptions } from "./moneyMetrics";
import { PAYING_BASIS, STAFF_TEST_BASIS, classifyPayers, isStaffOrTestAccount } from "./money-rules";

// Real users and paying people (a14, 2026-10-12) come from the ONE shared
// definition in ./money-rules (isStaffOrTestAccount + classifyPayers), the
// same rules Overview, Payments, the paid roster and the control plane use.

/** Engagement threshold — answer_history rows for a real user to count "engaged". */
const ENGAGED_MIN_ANSWERS = 25;

/** Per-user count requests issued concurrently (keeps the service pool sane). */
const CHUNK_SIZE = 20;

export interface GrowthFunnelStep {
  /** Absolute count at this stage. */
  count: number;
  /** Share of signups (0..1). signups itself is 1 when signups > 0, else 0. */
  pctOfSignups: number;
}

export interface GrowthMetrics {
  generated_at: string;
  /** Real users (all minus staff and test accounts). */
  signups: GrowthFunnelStep;
  /** Real users with >= 1 answer_history row. */
  activated: GrowthFunnelStep;
  /** Real users with >= 25 answer_history rows. */
  engaged: GrowthFunnelStep;
  /** Paying learners (shared definition in ./money-rules). */
  paying: GrowthFunnelStep;
  /** Plain-language note on how each funnel figure was derived. */
  basis: {
    signups: string;
    activated: string;
    engaged: string;
    paying: string;
  };
}

function step(count: number, signups: number): GrowthFunnelStep {
  return {
    count,
    pctOfSignups: signups > 0 ? count / signups : 0,
  };
}

/**
 * Compute the growth funnel from the live DB. READ-ONLY: every query here is a
 * SELECT/count; this never mutates. Real users and paying come from
 * ./money-rules.
 */
export async function computeGrowthMetrics(
  sb: SupabaseClient
): Promise<GrowthMetrics> {
  const now = new Date();
  const nowIso = now.toISOString();

  // ─── signups: real users = all accounts minus staff and test accounts ────
  const [accounts, subs, { ledger }] = await Promise.all([
    loadAccounts(sb),
    loadSubscriptions(sb, nowIso),
    loadLedger(sb),
  ]);
  const realUserIds: string[] = [];
  for (const u of accounts) {
    if (isStaffOrTestAccount(u)) continue;
    realUserIds.push(u.id);
  }
  const signups = realUserIds.length;

  // ─── activated + engaged: per-real-user HEAD count of answer_history ──────
  // Cap-safe (head counts return only the integer). Chunked so we never open
  // `signups` concurrent connections. One pass buckets both tiers.
  let activated = 0;
  let engaged = 0;
  for (let i = 0; i < realUserIds.length; i += CHUNK_SIZE) {
    const chunk = realUserIds.slice(i, i + CHUNK_SIZE);
    const counts = await Promise.all(
      chunk.map((uid) =>
        sb
          .from("answer_history")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid)
      )
    );
    for (const res of counts) {
      assertReadSucceeded(res);
      const n = res.count ?? 0;
      if (n >= 1) activated += 1;
      if (n >= ENGAGED_MIN_ANSWERS) engaged += 1;
    }
  }

  // ─── paying: the shared definition (positive payment, trials apart) ──────
  const payers = classifyPayers(subs, accountsById(accounts), now, new Map(ledger.payments.map((p) => [p.payment_id, p])));
  const paying = payers.paying.size;

  return {
    generated_at: nowIso,
    signups: step(signups, signups),
    activated: step(activated, signups),
    engaged: step(engaged, signups),
    paying: step(paying, signups),
    basis: {
      signups: `Real users: all accounts minus staff and test accounts. ${STAFF_TEST_BASIS}`,
      activated: `Real users with at least 1 answered question (a row in answer_history).`,
      engaged: `Real users with ${ENGAGED_MIN_ANSWERS} or more answered questions. Counted per user via an exact HEAD count of answer_history (no rows fetched), so the 1000-row REST cap never applies even for the heaviest users.`,
      paying: `${paying} paying learner${paying === 1 ? "" : "s"}, ${payers.inTrial.size} in trial. ${PAYING_BASIS}`,
    },
  };
}
