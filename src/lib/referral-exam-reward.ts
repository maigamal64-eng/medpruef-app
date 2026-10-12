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
 * their code, EACH activate the Whop card-on-file Pro trial (or a paid
 * Whop card subscription), AND EACH answer >=20 distinct questions
 * across >=2 distinct UTC calendar days earns free Pro through the
 * next sitting of THEIR OWN active_exam (+14 day buffer). No payment,
 * ever, from the REFERRER — the card requirement is on the REFEREE,
 * and it links a real card (0 € at trial start) but never charges the
 * referrer anything. The Level-2 grant to the referrer is NOT
 * auto-fired — it is enqueued for a one-click admin confirmation
 * (POST /api/admin/referrals/grant-exam-reward) so a human eyeballs
 * the farm signals before Pro ships.
 *
 * Card-trial gate (2026-07-11, [name]-directed tightening): the card is
 * the un-fakeable credibility signal a free-tier account cannot fake.
 * A referee counts toward N=2 only once they have an ACTIVE Whop
 * card-rail subscription row — see `hasActiveWhopCardSubscription()`
 * below for the exact predicate + why it's pinned on
 * provider/method, not tier (so a referee who converts straight to a
 * paid card plan, a stronger signal than the trial, also counts).
 * Gated independently by REFERRAL_REQUIRE_CARD_TRIAL (default TRUE —
 * note the INVERTED polarity vs the other flags below, on purpose:
 * this is a tightening, so its safe default is ON, not OFF).
 *
 * Three independent kill switches:
 *   - REFERRAL_EXAM_REWARD_ENABLED (env, default OFF) gates this
 *     entire module's binding code path (qualify + flag + grant). Every
 *     exported function below checks it FIRST and returns immediately
 *     when unset/false — not just the /api/answer call site — so there
 *     is no way to reach a row-flip or a grant with the flag off.
 *   - REFERRAL_REQUIRE_CARD_TRIAL (env, default TRUE — read as
 *     `!== 'false'`, the OPPOSITE default polarity of the flag above)
 *     gates only the card-signal requirement inside qualification.
 *     Setting it to the literal string 'false' falls back to
 *     activity-only qualification (the pre-card-gate behavior); any
 *     other value (unset, 'true', typo) keeps the card requirement ON.
 *   - users.referrals_enabled (DB, per-account) gates whether an
 *     account can see/use the referral UI at all. Checked upstream by
 *     the UI + /api/referrals/* routes; this module does not re-check
 *     it (a referee with the flag off never reaches qualification
 *     because they have no pending referrals row to begin with, since
 *     /api/referrals/claim is itself gated by the invite-only UI).
 *
 * REFERRAL_EXAM_REWARD_ENABLED=false stops NEW qualifications and NEW
 * grants. It does NOT claw back Pro already granted (stated out loud,
 * acceptable at this scale).
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

/**
 * Card-trial gate (2026-07-11). Default TRUE — deliberately the OPPOSITE
 * polarity of `isReferralExamRewardEnabled()`. This flag is a
 * TIGHTENING of an already-flag-gated mechanic, so its safe default is
 * "require the card" (ON), not "skip the check" (OFF): a missing/typo'd
 * var must never silently loosen the anti-abuse bar. Only the literal
 * string 'false' disables the card requirement and falls back to
 * activity-only qualification.
 */
export function isCardTrialRequired(): boolean {
  return (process.env.REFERRAL_REQUIRE_CARD_TRIAL ?? 'true') !== 'false'
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

/**
 * Whether a referrer's current access already covers the reward, and the
 * expiry to write otherwise. Pure. Never shortens or downgrades (a27 review
 * P1, same rule as admin_puyp_approve): admins keep their role and tier,
 * permanent Pro (tier 'pro' with no expiry) stays permanent, an
 * equal-or-later Pro expiry is kept, and a later expiry on another tier (for
 * example a trial) is carried over instead of cut.
 */
export function examRewardGrantDecision(
  referrer: { tier?: string | null; role?: string | null; tier_expires_at?: string | null },
  newExpiry: Date
): { kind: 'covered' } | { kind: 'grant'; expiry: Date } {
  const current = referrer.tier_expires_at ? new Date(referrer.tier_expires_at) : null
  const currentValid = current !== null && Number.isFinite(current.getTime())
  if (referrer.role === 'admin' || referrer.tier === 'admin') return { kind: 'covered' }
  if (referrer.tier === 'pro' && !referrer.tier_expires_at) return { kind: 'covered' }
  if (referrer.tier === 'pro' && currentValid && current!.getTime() >= newExpiry.getTime()) {
    return { kind: 'covered' }
  }
  const expiry = currentValid && current!.getTime() > newExpiry.getTime() ? current! : newExpiry
  return { kind: 'grant', expiry }
}

// ─────────────────────────────────────────────────────────────────────
// DB-backed operations
// ─────────────────────────────────────────────────────────────────────

interface PendingReferralRow {
  id: string
  referrer_user_id: string
}

/**
 * Does this user have an active Whop CARD-rail subscription (the trial
 * or a paid plan bought the same way)? This is the un-fakeable
 * credibility signal [name] asked for — a real card was linked with Whop
 * (KYC'd payment processor), even if the trial itself was €0.
 *
 * Predicate is pinned on `payment_provider='whop' AND
 * payment_method='card'`, NOT on tier. That is the literal instruction
 * (§ requirement 1: "pin the predicate on the provider/method that only
 * the card flow writes") — the exclusion target is the legacy no-card
 * regression row (tier='notes_free_trial', payment_provider='trial',
 * payment_method='telegram_trial'; DB-verified 2026-07-11, 1 live row),
 * which fails BOTH provider and method, not just tier. Restricting to
 * tier='notes_pro_trial' would ALSO wrongly exclude a referee who skips
 * the trial and converts straight to a paid card plan — a stronger
 * signal than the €0 trial, not a weaker one — so this checks the rail,
 * not the specific tier.
 *
 * `status='active'` means the signal is the CURRENT state, not
 * "ever linked a card" — a referee who trialed, cleared the activity
 * bar, then cancelled before this check ran would not (yet) satisfy
 * the gate. Acceptable simplification: qualification is durable once
 * flipped (the referrals row change is permanent), so this only
 * affects the ordering where cancellation happens strictly before
 * qualification is evaluated, not after.
 */
export async function hasActiveWhopCardSubscription(
  sb: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from('subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('payment_provider', 'whop')
      .eq('payment_method', 'card')
      .eq('status', 'active')
      .limit(1)
    if (error) return false
    return (data || []).length > 0
  } catch (err) {
    console.error('[referral-exam-reward] hasActiveWhopCardSubscription', err)
    return false
  }
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

    // 2b. Card-trial gate (2026-07-11): the referee must have activated
    // the Whop card-on-file Pro trial (or a paid Whop card plan) before
    // this row can qualify, on top of the activity bar below. Checked
    // BEFORE the activity queries so a referee who hasn't linked a card
    // yet short-circuits without the extra distinct-questions/distinct-
    // days round-trips — cheap ordering, not a correctness requirement.
    if (isCardTrialRequired()) {
      const hasCard = await hasActiveWhopCardSubscription(sb, refereeUserId)
      if (!hasCard) return
    }

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
 * Terminal-hold_reason values a queue entry can resolve to when a grant
 * can never proceed for structural reasons (not a "try again later"
 * state). Distinct from 'exam_reward_pending_review' (still awaiting
 * admin action) so GET /api/admin/referrals/pending-exam-rewards can
 * filter both cases correctly: show pending-review rows, hide resolved
 * ones, without ever leaving a row permanently stuck in the queue with
 * no path to clear it.
 */
type TerminalHoldReason = 'exam_reward_no_active_exam' | 'exam_reward_already_covered'

/**
 * Stamp every 'exam_reward_pending_review' row for this referrer with a
 * terminal hold_reason, so a no-op grant result (referrer has no
 * active_exam, or already has equal-or-later Pro access from elsewhere)
 * resolves the admin queue entry instead of leaving it stuck forever.
 * Best-effort — a failure here does not change the caller's grant
 * result, it just means the stale queue entry needs a manual look.
 */
async function resolveQueueEntry(
  sb: SupabaseClient,
  referrerUserId: string,
  reason: TerminalHoldReason
): Promise<void> {
  try {
    await sb
      .from('referrals')
      .update({ hold_reason: reason })
      .eq('referrer_user_id', referrerUserId)
      .eq('reward_type', 'pro_until_exam')
      .eq('hold_reason', 'exam_reward_pending_review')
  } catch (err) {
    console.error('[referral-exam-reward] resolveQueueEntry', err)
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
    // Re-check the threshold here, not just at enqueue time in
    // flagReferrerForRewardReview. Fat-finger protection: the admin
    // endpoint takes only a referrer_user_id in its POST body, so
    // without this a manually-crafted (or mis-clicked) call could grant
    // Pro to a referrer who was never actually enqueued, or whose
    // qualifying rows regressed between enqueue and confirm (e.g. an
    // admin manually reverted a qualified row). Uses the same
    // meetsRewardThreshold() the enqueue path uses, so the bar is
    // identical in both places.
    const { data: qualifyingRows, error: qualifyingErr } = await sb
      .from('referrals')
      .select('id, status')
      .eq('referrer_user_id', referrerUserId)
      .eq('reward_type', 'pro_until_exam')
      .in('status', ['qualified', 'rewarded'])
    if (qualifyingErr) {
      return { granted: false, reason: 'threshold_check_failed' }
    }
    if (!meetsRewardThreshold((qualifyingRows || []).length)) {
      return { granted: false, reason: 'below_threshold' }
    }

    const { data: referrer, error: referrerErr } = await sb
      .from('users')
      .select('id, active_exam, tier, role, tier_expires_at')
      .eq('id', referrerUserId)
      .maybeSingle()
    if (referrerErr || !referrer) {
      return { granted: false, reason: 'referrer_not_found' }
    }
    const activeExam = referrer.active_exam as PuypExamType | null
    if (!activeExam) {
      // Terminal no-op: this referrer can never be granted (no
      // active_exam to derive an expiry from) until they set one. Resolve
      // the queue entry now — otherwise hold_reason stays
      // 'exam_reward_pending_review' forever and the admin queue
      // (GET /api/admin/referrals/pending-exam-rewards) shows a stuck
      // item with no way to clear it short of a direct DB edit.
      await resolveQueueEntry(sb, referrerUserId, 'exam_reward_no_active_exam')
      return { granted: false, reason: 'no_active_exam' }
    }

    const newExpiry = computeGrantExpiry(activeExam)

    // Never shorten or downgrade (a27 review P1, same rule as
    // admin_puyp_approve): admins keep their role and tier, permanent Pro
    // (tier 'pro' with no expiry) stays permanent, and an equal-or-later
    // Pro expiry is kept. These are terminal no-ops, so the queue entry is
    // resolved (otherwise it would stay pending forever).
    const decision = examRewardGrantDecision(referrer, newExpiry)
    if (decision.kind === 'covered') {
      await resolveQueueEntry(sb, referrerUserId, 'exam_reward_already_covered')
      return { granted: false, reason: 'already_covers_new_expiry' }
    }
    const grantExpiry = decision.expiry

    // Compare-and-set on the row we read, so a payment or admin grant that
    // lands between the read and this write is never overwritten. The same
    // update shape as POST /api/admin/users/grant.
    let update = sb
      .from('users')
      .update({ tier: 'pro', tier_expires_at: grantExpiry.toISOString() })
      .eq('id', referrerUserId)
    update = referrer.tier ? update.eq('tier', referrer.tier as string) : update.is('tier', null)
    update = referrer.tier_expires_at
      ? update.eq('tier_expires_at', referrer.tier_expires_at as string)
      : update.is('tier_expires_at', null)
    const { data: updated, error: updErr } = await update.select('id')
    if (updErr) {
      return { granted: false, reason: 'update_failed' }
    }
    if (!updated || updated.length === 0) {
      // Access changed underneath us; the queue entry stays for a retry.
      return { granted: false, reason: 'access_changed_retry' }
    }

    // Mark every qualified pro_until_exam row for this referrer as rewarded.
    await sb
      .from('referrals')
      .update({ status: 'rewarded', rewarded_at: new Date().toISOString() })
      .eq('referrer_user_id', referrerUserId)
      .eq('reward_type', 'pro_until_exam')
      .eq('status', 'qualified')

    return { granted: true, newExpiry: grantExpiry.toISOString() }
  } catch (err) {
    console.error('[referral-exam-reward] grantExamRewardToReferrer', err)
    return { granted: false, reason: 'internal_error' }
  }
}
