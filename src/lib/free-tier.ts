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
  try {
    return new Date(tierExpiresAt).getTime() > Date.now()
  } catch {
    return true
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
