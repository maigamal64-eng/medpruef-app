/**
 * Free-tier gating helpers.
 *
 * Lock (2026-04-23): free users get 150 questions per exam type, Qbank
 * only (no spaced-repetition review, no mock exam, no bookmarks, no
 * notes). Pro / admin users are unrestricted. Guest (no `x-user-id`
 * header) is treated as free for the purpose of landing-page demos.
 *
 * The free set is a committed list of 150 question ids per exam type,
 * spread across topics (src/lib/free-set.ts + free-set.data.json, built by
 * scripts/free-set/build_free_set.py, a-free-set 2026-10-12). Every free
 * user sees the SAME set. Until 2026-10-12 it was the 150 lowest active ids,
 * which followed import order by topic; that old slice is frozen as the
 * legacy set so a learner keeps what they already answered (see the access
 * rule in free-set.ts).
 *
 * This module also holds the 1 h topic-counts cache (`getTopicCountsCached`)
 * used by every learner route that needs bank totals (topic list,
 * topic-progress, readiness, study-plan; a-stability 2026-10-12), since both
 * caches serve the question bank. Only the admin question browser reads
 * get_topic_counts directly, so an admin sees an edit at once.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { EXAM_SOURCE_IDS } from '@/lib/topics'
import {
  FREE_SET_SIZE,
  computeFreeAccess,
  freeSetIds,
  freeSetTopicsAtBuild,
  freeUniverseIds,
  type FreeAccess,
} from '@/lib/free-set'

/** Free-tier question allowance per exam type. */
export const FREE_TIER_QUESTIONS_PER_EXAM = FREE_SET_SIZE

/**
 * Result of a free-set load. Kept as a union for the callers written against
 * the old database slice; the committed set cannot be unavailable, so this is
 * always `ok: true` now.
 */
export type FreeSliceResult = { ok: true; ids: number[] } | { ok: false }

/** The free set of an exam type (committed data, no database read). */
export async function loadFreeSliceIds(
  _sb: SupabaseClient,
  examType: string
): Promise<FreeSliceResult> {
  return { ok: true, ids: [...freeSetIds(examType)] }
}

/** The free set of an exam type (committed data, no database read). */
export async function getFreeSliceIds(
  _sb: SupabaseClient,
  examType: string
): Promise<number[]> {
  return [...freeSetIds(examType)]
}

/**
 * The caller's free access in one exam type (rule in free-set.ts). Reads the
 * learner's answers inside the free universe (new set plus legacy set, at
 * most 300 ids, keyset paged). A failed read returns no answers: the cap does
 * not fire (fail open on the count) and legacy questions are not readable
 * (fail closed), so exposure stays inside the new set.
 */
export async function loadFreeAccess(
  sb: SupabaseClient,
  userId: string | null,
  examType: string,
  opts: { strict?: boolean } = {}
): Promise<FreeAccess> {
  // `strict` (display counts only): a failed history read throws instead of
  // reading as "nothing answered", so a page never shows a wrong count.
  const [answered, examAnswered] = !userId
    ? [new Set<number>(), 0]
    : await Promise.all([
        opts.strict
          ? readDistinctHistoryIds(sb, userId, { sliceIds: freeUniverseIds(examType) })
          : getAnsweredSliceIds(sb, userId, freeUniverseIds(examType)),
        // 2 Oct rule: every answered question in the exam counts toward the
        // cap; the read stops once 150 is proven.
        opts.strict
          ? readDistinctHistoryIds(sb, userId, { examType, untilCap: true }).then((s) => s.size)
          : countDistinctAnsweredInExam(sb, userId, examType, { untilCap: true }),
      ])
  return computeFreeAccess({
    exam: examType,
    answered,
    signedIn: Boolean(userId),
    enforced: isFreeTierEnforced(),
    examAnswered,
  })
}

// Live topic of each ACTIVE new-set id, cached 5 minutes per instance, so the
// "free questions left" counts follow deactivations and topic edits. On a
// failed read the last good copy is served, then the build-time topics.
const FREE_SET_LIVE_TTL_MS = 5 * 60 * 1000
const FREE_SET_LIVE = new Map<string, { topicOf: Map<number, string>; expiresAt: number }>()

/** Test seam. */
export function resetFreeSetLiveCacheForTests(): void {
  FREE_SET_LIVE.clear()
}

export async function loadFreeSetLive(
  sb: SupabaseClient,
  examType: string
): Promise<Map<number, string>> {
  const ids = freeSetIds(examType)
  if (ids.length === 0) return new Map()
  const cached = FREE_SET_LIVE.get(examType)
  if (cached && cached.expiresAt > Date.now()) return cached.topicOf
  try {
    const { data, error } = await sb
      .from('questions')
      .select('id, topic')
      .in('id', [...ids])
      .eq('is_active', true)
      .eq('exam_type', examType)
    if (error) throw error
    const topicOf = new Map<number, string>()
    for (const row of (data ?? []) as { id: number; topic: string | null }[]) {
      if (typeof row.id === 'number' && row.topic) topicOf.set(row.id, row.topic)
    }
    FREE_SET_LIVE.set(examType, { topicOf, expiresAt: Date.now() + FREE_SET_LIVE_TTL_MS })
    return topicOf
  } catch (err) {
    console.error('[free-tier] free set live read failed', {
      examType,
      code: (err as { code?: string } | null)?.code ?? null,
    })
    return cached?.topicOf ?? freeSetTopicsAtBuild(examType)
  }
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

/** Test seam: forget every cached and in-flight topic count. */
export function resetTopicCountsCacheForTests(): void {
  TOPIC_COUNTS_CACHE.clear()
  TOPIC_COUNTS_INFLIGHT.clear()
}

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
// a-free-set (2026-10-12): the cap now counts distinct answered questions
// inside the free universe (new set plus legacy slice), computed by
// loadFreeAccess / computeFreeAccess (src/lib/free-set.ts); the paragraph
// below describes the original 2026-06-20 design.
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
  examType: string,
  opts: { untilCap?: boolean } = {}
): Promise<number> {
  try {
    return (await readDistinctHistoryIds(sb, userId, { examType, untilCap: opts.untilCap })).size

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
 * bounded (the free universe is at most 300 ids: new set plus legacy set)
 * regardless of how much history the user has.
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
  scope: { examType?: string; sliceIds?: number[]; untilCap?: boolean },
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
    if (scope.untilCap && seen.size >= FREE_TIER_QUESTIONS_PER_EXAM) return seen
    cursor = next
  }
}
