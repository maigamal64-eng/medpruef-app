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
 *
 * This module also holds the 1 h topic-counts cache (`getTopicCountsCached`)
 * used by the study routes, since both caches serve the question bank.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { EXAM_SOURCE_IDS } from '@/lib/topics'

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
 * Result of a free-slice load. `ok: false` means the slice could not be
 * read (database stall or error) and no cached copy exists. Callers that
 * gate a learner must treat that as "temporarily unavailable" (retryable
 * 503), never as "free allowance used up" (paywall).
 */
export type FreeSliceResult = { ok: true; ids: number[] } | { ok: false }

/** One query attempt for the free slice. Throws on any database error. */
async function querySliceOnce(sb: SupabaseClient, examType: string): Promise<number[]> {
  const { data, error } = await sb
    .from('questions')
    .select('id')
    .eq('is_active', true)
    .eq('exam_type', examType)
    .order('id', { ascending: true })
    .limit(FREE_TIER_QUESTIONS_PER_EXAM)
  if (error) throw error
  return (data || []).map((r) => r.id as number)
}

/**
 * Load the 150 lowest-id active question ids for an exam type, telling
 * "unavailable" apart from "empty".
 *
 * 2026-10-10 (W2-DB1): a single statement timeout (57014) on this select
 * used to surface as `[]`, which /api/questions turned into a paywall for
 * a free learner. Now: one retry on failure, then the stale cached slice
 * if we have one, then `{ ok: false }`.
 */
export async function loadFreeSliceIds(
  sb: SupabaseClient,
  examType: string
): Promise<FreeSliceResult> {
  const now = Date.now()
  const cached = SLICE_CACHE.get(examType)
  if (cached && cached.expiresAt > now) {
    return { ok: true, ids: cached.ids }
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ids = await querySliceOnce(sb, examType)
      SLICE_CACHE.set(examType, { ids, expiresAt: Date.now() + CACHE_TTL_MS })
      return { ok: true, ids }
    } catch (err) {
      console.error('[free-tier] free slice query failed', {
        examType,
        attempt,
        code: (err as { code?: string } | null)?.code ?? null,
        timeout: isStatementTimeout(err),
      })
    }
  }
  // Both attempts failed: a stale slice is still the right slice (the
  // lowest-id rows almost never change), so prefer it over failing.
  if (cached) return { ok: true, ids: cached.ids }
  return { ok: false }
}

/**
 * Return the 150 lowest-id active question ids for an exam type, or
 * fewer if the exam has <150 active rows.
 *
 * Legacy contract (kept for /api/offline/questions): on a persistent DB
 * error we return an empty array, which fails CLOSED there (we don't want
 * a Supabase outage to silently promote free users to pro). Callers that
 * show a learner a paywall on `[]` should use `loadFreeSliceIds` instead.
 */
export async function getFreeSliceIds(
  sb: SupabaseClient,
  examType: string
): Promise<number[]> {
  const result = await loadFreeSliceIds(sb, examType)
  return result.ok ? result.ids : []
}

/** PostgREST / Postgres "canceling statement due to statement timeout". */
export function isStatementTimeout(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  if (!e || typeof e !== 'object') return false
  if (e.code === '57014') return true
  return typeof e.message === 'string' && /statement timeout/i.test(e.message)
}

// ── Topic counts cache (2026-10-10, W2-DB1) ─────────────────────────
//
// `get_topic_counts` returns ~16 rows per exam type and only changes when
// questions are activated or deactivated. It ran on every topic-progress
// and topic-list request and was one of the three functions behind the
// learner-facing 57014 timeouts. Cache successful results per exam type
// (null = all exams) for 1 hour per server instance, share one in-flight
// query between concurrent callers, and serve the last good copy if a
// refresh fails. A failure with nothing cached is returned as an error.

export interface TopicCountRow {
  topic: string
  count: number
}

const TOPIC_COUNTS_TTL_MS = 60 * 60 * 1000 // 1 hour
const TOPIC_COUNTS_MAX_KEYS = 16
const TOPIC_COUNTS_CACHE = new Map<string, { rows: TopicCountRow[]; expiresAt: number }>()
const TOPIC_COUNTS_INFLIGHT = new Map<string, Promise<TopicCountRow[]>>()

export async function getTopicCountsCached(
  sb: SupabaseClient,
  examType: string | null
): Promise<{ data: TopicCountRow[]; error: null } | { data: null; error: unknown }> {
  const key = examType ?? '__all__'
  const cached = TOPIC_COUNTS_CACHE.get(key)
  if (cached && cached.expiresAt > Date.now()) return { data: cached.rows, error: null }

  let inflight = TOPIC_COUNTS_INFLIGHT.get(key)
  if (!inflight) {
    inflight = (async () => {
      const { data, error } = await sb.rpc('get_topic_counts', { p_exam_type: examType })
      if (error) throw error
      const rows = ((data || []) as { topic: string; count: number | string }[]).map((r) => ({
        topic: r.topic,
        count: Number(r.count),
      }))
      // Keys come from request input; bound the map so junk exam types
      // cannot grow it (real keys: 3 exams + all).
      // R2-10: drop expired entries first so stale junk keys cannot pin the cap.
      const nowMs = Date.now()
      for (const [k, v] of TOPIC_COUNTS_CACHE) if (v.expiresAt <= nowMs) TOPIC_COUNTS_CACHE.delete(k)
      const knownKey = key === '__all__' || (EXAM_SOURCE_IDS as string[]).includes(key)
      if (knownKey && (TOPIC_COUNTS_CACHE.has(key) || TOPIC_COUNTS_CACHE.size < TOPIC_COUNTS_MAX_KEYS)) {
        TOPIC_COUNTS_CACHE.set(key, { rows, expiresAt: Date.now() + TOPIC_COUNTS_TTL_MS })
      }
      return rows
    })().finally(() => {
      TOPIC_COUNTS_INFLIGHT.delete(key)
    })
    TOPIC_COUNTS_INFLIGHT.set(key, inflight)
  }

  try {
    return { data: await inflight, error: null }
  } catch (error) {
    if (cached) return { data: cached.rows, error: null }
    return { data: null, error }
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
    return (await readDistinctHistoryIds(sb, userId, { examType })).size

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
    return await readDistinctHistoryIds(sb, userId, { sliceIds })

  } catch (err) {
    console.error('[free-tier] getAnsweredSliceIds unexpected', {
      userId,
      err,
    })
    return new Set()
  }
}

/**
 * Keyset through question IDs, skipping duplicate attempts after each batch.
 * A requested limit cannot override PostgREST's max_rows. Even a short batch
 * may be capped, so continue until an empty response, not until batch < limit.
 * The (user_id, question_id) index bounds each next lookup. No offset or giant
 * list of history IDs is serialized, and repeated attempts cannot hide IDs.
 */
async function readDistinctHistoryIds(
  sb: SupabaseClient,
  userId: string,
  scope: { examType?: string; sliceIds?: number[] },
): Promise<Set<number>> {
  const seen = new Set<number>()
  let cursor = 0
  while (true) {
    let query = sb.from('answer_history')
      .select(scope.examType ? 'question_id, questions!inner(exam_type, is_active)' : 'question_id')
      .eq('user_id', userId)
      .gt('question_id', cursor)
      .order('question_id', { ascending: true })
      .limit(1000)
    if (scope.examType) {
      query = query.eq('questions.exam_type', scope.examType).eq('questions.is_active', true)
    }
    if (scope.sliceIds) query = query.in('question_id', scope.sliceIds)
    const { data, error } = await query
    // Once the cap is proven, a later unavailable page cannot erase it.
    if (error && scope.examType && seen.size >= FREE_TIER_QUESTIONS_PER_EXAM) return seen
    if (error) throw error
    if (!data?.length) return seen
    let next = cursor
    for (const row of data) {
      const id = (row as { question_id?: number }).question_id
      if (typeof id === 'number' && Number.isInteger(id) && id > cursor) {
        seen.add(id)
        next = Math.max(next, id)
      }
    }
    if (next === cursor) throw new Error('History pagination did not advance')
    cursor = next
  }
}
