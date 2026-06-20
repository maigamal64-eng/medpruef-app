/**
 * Free-tier gating helpers.
 *
 * Lock (2026-04-23): free users get 150 questions per exam type, Qbank
 * only (no spaced-repetition review, no mock exam, no bookmarks, no
 * notes). Pro / admin users are unrestricted. Guest (no `x-user-id`
 * header) is treated as free for the purpose of landing-page demos.
 *
 * The "free slice" is a deterministic set of the 150 lowest-id
 * `is_active=true` questions for a given exam type. Every free user
 * sees the SAME 150 questions — this is intentional:
 *   - Users who find us via word-of-mouth can compare notes
 *   - The cache is per-process, not per-user, so memory stays bounded
 *   - Seen-question overlap across free users is a conversion driver
 *     ("I already did question #42 on your phone — let me sign up so
 *     I don't lose my progress")
 *
 * To change the sample size globally: bump `FREE_TIER_QUESTIONS_PER_EXAM`
 * and wait 5 min for the cache to expire, or restart the server.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Free-tier question allowance per exam type. */
export const FREE_TIER_QUESTIONS_PER_EXAM = 150

/**
 * In-memory cache. Key: exam_type string. Value: the sorted-by-id
 * slice + expiry timestamp. 5-minute TTL keeps the lookup off the
 * hot path for virtually every free-user request.
 *
 * Process-local only — each serverless-function instance rebuilds on
 * first hit. That's fine: a cold-start cost of ~50 ms is negligible
 * compared to the downstream question fetch, and the data is stable
 * so a race on first fill just means two instances do the same query.
 */
interface CacheEntry {
  ids: number[]
  expiresAt: number
}

const SLICE_CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Return the 150 lowest-id active question ids for an exam type, or
 * fewer if the exam has <150 active rows (rare — only pharma at 335
 * still has >150).
 *
 * On DB error we return an empty array. That causes the caller's
 * intersection to be empty, which means a free user hits the paywall
 * immediately — fail-closed is the right call here (we don't want
 * a Supabase outage to silently promote free users to pro).
 */
export async function getFreeSliceIds(
  sb: SupabaseClient,
  examType: string
): Promise<number[]> {
  const now = Date.now()
  const cached = SLICE_CACHE.get(examType)
  if (cached && cached.expiresAt > now) {
    return cached.ids
  }

  try {
    const { data, error } = await sb
      .from('questions')
      .select('id')
      .eq('is_active', true)
      .eq('exam_type', examType)
      .order('id', { ascending: true })
      .limit(FREE_TIER_QUESTIONS_PER_EXAM)

    if (error) {
      console.error('[free-tier] getFreeSliceIds', { examType, error })
      return cached?.ids ?? []
    }
    const ids = (data || []).map((r) => r.id as number)
    SLICE_CACHE.set(examType, { ids, expiresAt: now + CACHE_TTL_MS })
    return ids
  } catch (err) {
    console.error('[free-tier] getFreeSliceIds unexpected', {
      examType,
      err,
    })
    return cached?.ids ?? []
  }
}

/**
 * Is the caller Pro-tier (or admin)? Pass the tier string from
 * `requireUser(req)` + the `tier_expires_at` column if available.
 *
 * A user whose subscription has expired (tier_expires_at < now()) is
 * treated as free, even if `users.tier='pro'` is stale — the webhook
 * or an admin action is supposed to flip it back to 'free', but
 * defence-in-depth costs nothing.
 */
export function isPaidTier(
  tier: string | null | undefined,
  tierExpiresAt?: string | null | undefined
): boolean {
  if (!tier) return false
  if (tier === 'admin') return true
  if (tier !== 'pro') return false
  if (!tierExpiresAt) return true // pro with no expiry → treat as paid
  // Fail CLOSED on an unparseable/invalid expiry. `new Date(bad).getTime()`
  // is NaN (no throw for a malformed string), so guard on Number.isFinite so
  // the NaN case provably denies Pro. The `catch` keeps the same fail-closed
  // default if a future parse path ever throws. A paywall gate must never
  // grant paid access on corrupt data.
  try {
    const ts = new Date(tierExpiresAt).getTime()
    return Number.isFinite(ts) && ts > Date.now()
  } catch {
    return false
  }
}

/**
 * Convenience negation — free-tier includes unauthenticated guests.
 */
export function isFreeTier(
  tier: string | null | undefined,
  tierExpiresAt?: string | null | undefined
): boolean {
  return !isPaidTier(tier, tierExpiresAt)
}

/** Gate identifiers surfaced in 402 paywall responses. */
export type PaywallGate =
  | 'spaced_repetition'
  | 'wrong_only'
  | 'mock_exam'
  | 'bookmarks'
  | 'notes'
  | 'qbank_limit'

// ── Durable free-tier ENFORCEMENT (2026-06-20) ──────────────────────
//
// History of "the free tier" in this codebase:
//   - The 150-question *slice* (above) caps WHICH questions a free user
//     can ever draw to the 150 lowest-id active rows per exam_type. That
//     has been live since Apr 2026 — but the paywall *trigger* in the
//     quiz client (`seenIdsRef`) is in-memory and resets on reload, so a
//     returning free user re-draws the same 150 forever and the upgrade
//     prompt almost never fires. Plus `/api/offline/questions` bypassed
//     the slice entirely (a free user could download up to 500/call into
//     IndexedDB). Net effect: free access was effectively unlimited.
//
// This layer adds a DURABLE cap on top of the slice: count the DISTINCT
// questions a (user, exam_type) has actually ANSWERED (from
// `answer_history`, cross-device) and wall NEW/unseen questions once that
// reaches FREE_TIER_QUESTIONS_PER_EXAM. The cap is on NEW questions only
// — a free user keeps re-reading questions they've already answered (and
// their cached AI explanations); see the caller logic in /api/questions.
//
// Reversibility: everything here is gated behind FREE_TIER_ENFORCED. With
// the flag OFF, the durable cap is skipped and behaviour falls back to
// exactly the pre-existing slice-only gate (today's live behaviour).

/**
 * Master kill-switch for durable free-tier enforcement.
 *
 * Default is ENABLED (`true`): the env var must be the explicit string
 * `'false'` to turn it off. This means a missing/typo'd var fails *safe*
 * (enforcement stays on) rather than silently re-opening the bank.
 *
 * Set `FREE_TIER_ENFORCED=false` on Vercel to instantly restore the old
 * (slice-only, non-durable) behaviour without a code change.
 */
export function isFreeTierEnforced(): boolean {
  return (process.env.FREE_TIER_ENFORCED ?? 'true').toLowerCase() !== 'false'
}

/**
 * Count the DISTINCT active questions a user has answered within one
 * exam_type, from `answer_history` joined to `questions` by exam_type.
 *
 * This is the durable cross-device signal (every answer is written to
 * `answer_history` by /api/answer), so unlike the client `seenIdsRef`
 * it survives reloads, new devices, and cleared local storage.
 *
 * Mirrors the fallback query in `puyp.ts#computeQbankCompletion`, but
 * returns the RAW distinct count (not clamped to the exam total, not a
 * percentage) so the caller can compare directly against the 150 cap.
 *
 * `is_active` is enforced via the embedded `questions!inner` filter so a
 * question that was later deactivated does not consume the user's
 * allowance. On any DB error we return 0 (fail OPEN on the *count* — a
 * read outage should not wall a paying-intent user out of the product;
 * the slice still bounds exposure to 150 questions regardless).
 */
export async function countDistinctAnsweredInExam(
  sb: SupabaseClient,
  userId: string,
  examType: string
): Promise<number> {
  try {
    const { data, error } = await sb
      .from('answer_history')
      .select('question_id, questions!inner(exam_type, is_active)')
      .eq('user_id', userId)
      .eq('questions.exam_type', examType)
      .eq('questions.is_active', true)
      .limit(50000)

    if (error) {
      console.error('[free-tier] countDistinctAnsweredInExam', {
        userId,
        examType,
        error,
      })
      return 0
    }
    const seen = new Set<number>()
    for (const r of data || []) {
      const qid = (r as { question_id?: number }).question_id
      if (typeof qid === 'number') seen.add(qid)
    }
    return seen.size
  } catch (err) {
    console.error('[free-tier] countDistinctAnsweredInExam unexpected', {
      userId,
      examType,
      err,
    })
    return 0
  }
}

/**
 * Return the set of question ids (within the free slice for `examType`)
 * that the user has ALREADY answered. Used so the cap walls only NEW
 * questions: a free user at 150/150 can still be served a question they
 * previously answered (to re-read it + its cached explanation), but no
 * unseen one.
 *
 * We intersect with `sliceIds` up front so the `.in()` filter stays
 * bounded to ≤150 ids regardless of how much history the user has.
 * Empty `sliceIds` → empty set (nothing to re-serve).
 */
export async function getAnsweredSliceIds(
  sb: SupabaseClient,
  userId: string,
  sliceIds: number[]
): Promise<Set<number>> {
  if (sliceIds.length === 0) return new Set()
  try {
    const { data, error } = await sb
      .from('answer_history')
      .select('question_id')
      .eq('user_id', userId)
      .in('question_id', sliceIds)
      .limit(50000)
    if (error) {
      console.error('[free-tier] getAnsweredSliceIds', { userId, error })
      return new Set()
    }
    const seen = new Set<number>()
    for (const r of data || []) {
      const qid = (r as { question_id?: number }).question_id
      if (typeof qid === 'number') seen.add(qid)
    }
    return seen
  } catch (err) {
    console.error('[free-tier] getAnsweredSliceIds unexpected', {
      userId,
      err,
    })
    return new Set()
  }
}
