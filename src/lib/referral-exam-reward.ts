/**
 * Referral exam reward — 2026-07-11 (Praxis synthesis, workflow wdtk7s53t).
 *
 * The non-cash referral mechanic that supersedes the €40/tiered-cash
 * program (`src/lib/referrals.ts`, PAUSED for new/enrolled users, not
 * deleted) for anyone the flag below applies to. Full business-fact
 * block: MEDPRUF-SOT.md §2.x "Referral reward — Pro through the exam
 * window". Full mechanics/anti-abuse posture: the build spec at
 * reviews/referral-exam-reward-2026-07-11/SPEC.md §2-3.
 *
 * Offer (one line): a referrer who gets N=2 colleagues to sign up with
 * their code AND each answer >=20 distinct questions across >=2
 * distinct UTC calendar days earns free Pro through the next sitting
 * of THEIR OWN active_exam (+14 day buffer). No payment, ever. The
 * Level-2 grant to the referrer is NOT auto-fired — it is enqueued for
 * a one-click admin confirmation (POST /api/admin/referrals/grant-
 * exam-reward) so a human eyeballs the farm signals before Pro ships.
 *
 * Two independent kill switches:
 *   - REFERRAL_EXAM_REWARD_ENABLED (env, default OFF) gates this
 *     entire module's binding code path (qualify + flag + grant). Every
 *     exported function below checks it FIRST and returns immediately
 *     when unset/false — not just the /api/answer call site — so there
 *     is no way to reach a row-flip or a grant with the flag off.
 *   - users.referrals_enabled (DB, per-account) gates whether an
 *     account can see/use the referral UI at all. Checked upstream by
 *     the UI + /api/referrals/* routes; this module does not re-check
 *     it (a referee with the flag off never reaches qualification
 *     because they have no pending referrals row to begin with, since
 *     /api/referrals/claim is itself gated by the invite-only UI).
 *
 * Flag OFF stops NEW qualifications and NEW grants. It does NOT claw
 * back Pro already granted (stated out loud, acceptable at this scale).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { countDistinctAnsweredInExam } from '@/lib/free-tier'
import { suggestNextExpiresAt, type PuypExamType } from '@/lib/exam-dates'

// ─────────────────────────────────────────────────────────────────────
// Tunables (env-overridable, spec §10.3 — confirm before flipping ON)
// ─────────────────────────────────────────────────────────────────────

/** Distinct qualified referrals a referrer needs before a grant is enqueued. */
export const REFERRAL_EXAM_REWARD_THRESHOLD = Number(
  process.env.REFERRAL_EXAM_REWARD_THRESHOLD
) || 2

/** Distinct questions a referee must answer (across >=2 distinct days) to qualify. */
export const REFERRAL_EXAM_ACTIVITY_BAR = Number(
  process.env.REFERRAL_EXAM_ACTIVITY_BAR
) || 20

/** Distinct UTC calendar days a referee's activity must span. Not env-tunable (structural anti-abuse control, spec §3.1). */
export const REFERRAL_EXAM_ACTIVITY_MIN_DAYS = 2

/** Buffer (days) added past the referrer's next exam sitting when computing the grant expiry. */
export const REFERRAL_EXAM_REWARD_BUFFER_DAYS = 14

/**
 * Master kill-switch. Default OFF (fail-safe): the env var must be the
 * exact string 'true' to enable. A missing/typo'd var never
 * accidentally turns this on.
 */
export function isReferralExamRewardEnabled(): boolean {
  return process.env.REFERRAL_EXAM_REWARD_ENABLED === 'true'
}

// ─────────────────────────────────────────────────────────────────────
// Pure decision logic — no DB, no env reads. Exported so the OFF/ON
// state test (scripts/test_referral_reward_offstate.mjs) can exercise
// the actual thresholds without a live Supabase client.
// ─────────────────────────────────────────────────────────────────────

/** Count distinct UTC calendar days (YYYY-MM-DD) across a list of ISO timestamps. */
export function countDistinctUtcDays(isoTimestamps: string[]): number {
  const days = new Set<string>()
  for (const ts of isoTimestamps) {
    const d = new Date(ts)
    if (!Number.isFinite(d.getTime())) continue
    days.add(d.toISOString().slice(0, 10))
  }
  return days.size
}

/**
 * Does this referee's activity clear the qualification bar? Pure — the
 * caller supplies the already-fetched distinct-question count (from
 * `countDistinctAnsweredInExam`) and the referee's raw answer
 * timestamps (for the distinct-day count).
 */
export function meetsActivityBar(
  distinctQuestionCount: number,
  answerTimestamps: string[]
): boolean {
  if (distinctQuestionCount < REFERRAL_EXAM_ACTIVITY_BAR) return false
  return countDistinctUtcDays(answerTimestamps) >= REFERRAL_EXAM_ACTIVITY_MIN_DAYS
}

/** Has this referrer crossed the reward threshold and is therefore grant-eligible? */
export function meetsRewardThreshold(qualifiedOrRewardedCount: number): boolean {
  return qualifiedOrRewardedCount >= REFERRAL_EXAM_REWARD_THRESHOLD
}

/**
 * Compute the grant expiry for a referrer's active_exam. Thin wrapper
 * around `suggestNextExpiresAt` that asserts non-null defensively —
 * `isPaidTier` (src/lib/free-tier.ts) treats tier='pro' + NULL expiry
 * as PERMANENT paid access, so a null write here would silently grant
 * free Pro forever. `suggestNextExpiresAt` structurally never returns
 * null (falls back to now+3mo for undated exam types), but this
 * function throws rather than trust that invariant silently.
 */
export function computeGrantExpiry(activeExam: PuypExamType): Date {
  const expiry = suggestNextExpiresAt(activeExam, REFERRAL_EXAM_REWARD_BUFFER_DAYS)
  if (!expiry || !Number.isFinite(expiry.getTime())) {
    throw new Error(
      `[referral-exam-reward] suggestNextExpiresAt returned a non-date for active_exam=${activeExam}`
    )
  }
  return expiry
}

// ─────────────────────────────────────────────────────────────────────
// DB-backed operations
// ─────────────────────────────────────────────────────────────────────

interface PendingReferralRow {
  id: string
  referrer_user_id: string
}

/**
 * Level 1 — flip a referee's `pending` referrals row to `qualified` once
 * their activity clears the bar. Called best-effort, never-throw, from
 * POST /api/answer after every answer write (src/app/api/answer/route.ts).
 *
 * On a successful flip, cascades into `flagReferrerForRewardReview` so
 * the referrer's Level-2 grant queue stays current — but never grants
 * anything itself.
 */
export async function qualifyReferralOnActivity(
  sb: SupabaseClient,
  refereeUserId: string
): Promise<void> {
  if (!isReferralExamRewardEnabled()) return

  try {
    // 1. Referee's code + active_exam.
    const { data: referee, error: refereeErr } = await sb
      .from('users')
      .select('referred_by_code, active_exam')
      .eq('id', refereeUserId)
      .maybeSingle()
    if (refereeErr || !referee) return
    const referredByCode = referee.referred_by_code as string | null
    const activeExam = referee.active_exam as string | null
    if (!referredByCode || !activeExam) return

    // 2. Their pending referrals row (this referee as referee_user_id).
    const { data: pending, error: pendingErr } = await sb
      .from('referrals')
      .select('id, referrer_user_id')
      .eq('referee_user_id', refereeUserId)
      .eq('status', 'pending')
      .maybeSingle()
    if (pendingErr || !pending) return
    const row = pending as PendingReferralRow

    // 3. Distinct questions — the audited helper, NOT raw answer_history
    //    row count (re-answering one question must not count twice,
    //    spec §2 BLOCKER-7).
    const distinctCount = await countDistinctAnsweredInExam(
      sb,
      refereeUserId,
      activeExam
    )
    if (distinctCount < REFERRAL_EXAM_ACTIVITY_BAR) return

    // 4. Distinct days — net-new (countDistinctAnsweredInExam counts
    //    questions, not days), so pull the referee's answer_history
    //    timestamps directly.
    const { data: history, error: historyErr } = await sb
      .from('answer_history')
      .select('created_at')
      .eq('user_id', refereeUserId)
      .limit(50000)
    if (historyErr) return
    const timestamps = (history || [])
      .map((r) => (r as { created_at?: string }).created_at)
      .filter((v): v is string => !!v)

    if (!meetsActivityBar(distinctCount, timestamps)) return

    // 5. Flip the row.
    const { error: updErr } = await sb
      .from('referrals')
      .update({
        status: 'qualified',
        qualified_at: new Date().toISOString(),
        hold_expires_at: null,
        reward_credit_cents: 0,
        reward_type: 'pro_until_exam',
      })
      .eq('id', row.id)
      .eq('status', 'pending') // idempotency guard against a race double-flip
    if (updErr) return

    // 6. Cascade — does the referrer now cross the reward threshold?
    await flagReferrerForRewardReview(sb, row.referrer_user_id)
  } catch (err) {
    console.error('[referral-exam-reward] qualifyReferralOnActivity', err)
  }
}

/**
 * Level 2 — check whether a referrer has crossed the reward threshold
 * and, if so, ENQUEUE a pending grant for admin review. Never grants.
 *
 * "Enqueue" = stamp `hold_reason='exam_reward_pending_review'` +
 * `hold_expires_at=now()` on the triggering (most recently qualified)
 * row, so it surfaces in /admin/referrals's pending-grants list. Skips
 * silently if the referrer already has a pending or completed grant
 * (idempotent — a 3rd, 4th... qualified referral does not re-enqueue).
 */
export async function flagReferrerForRewardReview(
  sb: SupabaseClient,
  referrerUserId: string
): Promise<void> {
  if (!isReferralExamRewardEnabled()) return

  try {
    const { data: rows, error } = await sb
      .from('referrals')
      .select('id, status, hold_reason, created_at')
      .eq('referrer_user_id', referrerUserId)
      .eq('reward_type', 'pro_until_exam')
      .in('status', ['qualified', 'rewarded'])
      .order('created_at', { ascending: true })
    if (error || !rows) return

    const qualifiedOrRewarded = rows as Array<{
      id: string
      status: string
      hold_reason: string | null
      created_at: string
    }>

    if (!meetsRewardThreshold(qualifiedOrRewarded.length)) return

    // Already rewarded, or already enqueued for review — idempotent no-op.
    const alreadyRewarded = qualifiedOrRewarded.some((r) => r.status === 'rewarded')
    const alreadyEnqueued = qualifiedOrRewarded.some(
      (r) => r.hold_reason === 'exam_reward_pending_review'
    )
    if (alreadyRewarded || alreadyEnqueued) return

    // Stamp the Nth (threshold-crossing) row as the queue entry — the
    // oldest-first ordering above means index [threshold - 1] is the
    // row whose qualification pushed the referrer over the bar.
    const triggerRow = qualifiedOrRewarded[REFERRAL_EXAM_REWARD_THRESHOLD - 1]
    if (!triggerRow) return

    await sb
      .from('referrals')
      .update({
        hold_reason: 'exam_reward_pending_review',
        hold_expires_at: new Date().toISOString(),
      })
      .eq('id', triggerRow.id)
  } catch (err) {
    console.error('[referral-exam-reward] flagReferrerForRewardReview', err)
  }
}

/**
 * The actual grant. ONLY ever called from POST
 * /api/admin/referrals/grant-exam-reward — this is the single place in
 * the codebase where a referrer's tier is mutated by this program.
 *
 * Idempotent: re-running for a referrer who already has an active
 * pro_until_exam grant is a silent no-op (never regresses a later
 * expiry, per spec §2/§3.5).
 */
export async function grantExamRewardToReferrer(
  sb: SupabaseClient,
  referrerUserId: string
): Promise<{ granted: boolean; newExpiry?: string; reason?: string }> {
  if (!isReferralExamRewardEnabled()) {
    return { granted: false, reason: 'flag_off' }
  }

  try {
    const { data: referrer, error: referrerErr } = await sb
      .from('users')
      .select('id, active_exam, tier, tier_expires_at')
      .eq('id', referrerUserId)
      .maybeSingle()
    if (referrerErr || !referrer) {
      return { granted: false, reason: 'referrer_not_found' }
    }
    const activeExam = referrer.active_exam as PuypExamType | null
    if (!activeExam) {
      return { granted: false, reason: 'no_active_exam' }
    }

    const newExpiry = computeGrantExpiry(activeExam)

    // Idempotency: never regress an existing later expiry.
    const currentExpiry = referrer.tier_expires_at
      ? new Date(referrer.tier_expires_at as string)
      : null
    if (
      referrer.tier === 'pro' &&
      currentExpiry &&
      currentExpiry.getTime() >= newExpiry.getTime()
    ) {
      return { granted: false, reason: 'already_covers_new_expiry' }
    }

    // The exact update shape from POST /api/admin/users/grant.
    const { error: updErr } = await sb
      .from('users')
      .update({ tier: 'pro', tier_expires_at: newExpiry.toISOString() })
      .eq('id', referrerUserId)
    if (updErr) {
      return { granted: false, reason: 'update_failed' }
    }

    // Mark every qualified pro_until_exam row for this referrer as rewarded.
    await sb
      .from('referrals')
      .update({ status: 'rewarded', rewarded_at: new Date().toISOString() })
      .eq('referrer_user_id', referrerUserId)
      .eq('reward_type', 'pro_until_exam')
      .eq('status', 'qualified')

    return { granted: true, newExpiry: newExpiry.toISOString() }
  } catch (err) {
    console.error('[referral-exam-reward] grantExamRewardToReferrer', err)
    return { granted: false, reason: 'internal_error' }
  }
}
