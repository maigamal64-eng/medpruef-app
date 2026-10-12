import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { resolveOptionalUser } from '@/lib/auth-guard'
import { generateWrongOptions, buildMCQOptions, buildMCQFromStored, buildMCQFromChoices, filterDisplayableChoices } from '@/lib/mcq'
import type { StoredChoice } from '@/lib/mcq'
import { VIENNA_EXAM_PARTS, DEFAULT_EXAM_SOURCE, EXAM_SOURCE_IDS } from '@/lib/topics'
import { FLASHCARD_HEADERS, splitFlashcards } from '@/lib/flashcard-eligibility'
import { isMissingRuleError } from '@/lib/mistakes'
import { captureServerError } from '@/lib/sentry-capture'
import {
  FREE_TIER_QUESTIONS_PER_EXAM,
  loadFreeSliceIds,
  getTopicCountsCached,
  isFreeTier,
  isFreeTierEnforced,
  countDistinctAnsweredInExam,
  getAnsweredSliceIds,
} from '@/lib/free-tier'
import { logFreeCapHit } from '@/lib/free-access'
import { canUse, featureForPracticeMode, FEATURE_GATE } from '@/lib/entitlements'

/**
 * Resolve the caller's tier from the verified session token (S-1, via
 * resolveOptionalUser). Unlike `requireUser`, this does NOT 401 on
 * missing/unknown users — instead it returns `{ tier: 'free',
 * userId: null }` so guest traffic is gated the same way as a logged-in
 * free user.
 *
 * Runs ONE indexed lookup on `users.id`. For a 150ms-baseline route
 * that's acceptable overhead. If tier gating becomes a hot path we'd
 * cache by userId in a per-instance Map.
 */
async function resolveTier(
  req: NextRequest,
  sb: ReturnType<typeof getServiceClient>
): Promise<{
  userId: string | null
  tier: 'free' | 'pro' | 'admin'
  tierExpiresAt: string | null
  role: 'user' | 'admin'
}> {
  // Verified session userId (signed token, S-1) — a forged x-user-id can
  // no longer resolve another user's tier or leak their seen/wrong sets.
  const sessionUserId = resolveOptionalUser(req)
  if (!sessionUserId) {
    return { userId: null, tier: 'free', tierExpiresAt: null, role: 'user' }
  }
  try {
    // 2026-04-24: also select `role` so we can treat `role='admin'` as
    // Pro-level access even when `tier` is `'free'`/null. The admin
    // user (admin@medpruf.com) has tier='admin' in practice, but
    // defence-in-depth: any admin-role row bypasses the free-tier gate.
    const { data } = await sb
      .from('users')
      .select('id, tier, tier_expires_at, role')
      .eq('id', sessionUserId)
      .maybeSingle()
    if (!data) return { userId: null, tier: 'free', tierExpiresAt: null, role: 'user' }
    return {
      userId: data.id as string,
      tier: ((data.tier as string) || 'free') as 'free' | 'pro' | 'admin',
      tierExpiresAt:
        (data as { tier_expires_at?: string | null }).tier_expires_at ?? null,
      role: ((data.role as string) || 'user') as 'user' | 'admin',
    }
  } catch {
    return { userId: null, tier: 'free', tierExpiresAt: null, role: 'user' }
  }
}

export const dynamic = 'force-dynamic'

/**
 * Apply exam source filter to a Supabase query builder.
 *
 * As of 2026-04-12 the `examSource` query param matches `questions.exam_type`
 * directly. Legacy 'SIP' value is mapped to 'kenntnispruefung' for backwards
 * compatibility with clients still holding the old localStorage value.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyExamSourceFilter(query: any, examSource: string | null) {
  if (!examSource || examSource === 'all') return query
  const normalized = examSource === 'SIP' ? 'kenntnispruefung' : examSource
  if (!(EXAM_SOURCE_IDS as string[]).includes(normalized)) {
    // Unknown value — fall back to default exam to avoid leaking cross-exam data
    return query.eq('exam_type', DEFAULT_EXAM_SOURCE)
  }
  return query.eq('exam_type', normalized)
}

interface FilterParams {
  examSource: string | null
  topic: string | null
  topics: string[]
  part: 'sip4' | 'sip5' | null
  tag: string | null
  tags: string[]
  search: string | null
  ids: number[]
  excludeIds: number[]
  examDateFrom: string | null
  examDateTo: string | null
  /** Practice mode: 'unseen' = exclude already-answered, 'wrong' = only wrong answers, 'review' = spaced-rep due */
  practiceMode: 'all' | 'unseen' | 'wrong' | 'review'
  /** Filter by exam year — matches questions whose exam_dates array contains this year prefix */
  examYear: string | null
}

/**
 * Build enumerated list of YYYY-MM month strings between `from` and `to`, inclusive.
 * Capped at 48 entries (4 years) to keep the overlap array bounded.
 * If only one bound is present, extends 12 months in the unbounded direction.
 */
function buildMonthRange(from?: string | null, to?: string | null): string[] {
  const MAX = 48
  const re = /^(\d{4})-(\d{2})$/
  const parse = (s: string | null | undefined): [number, number] | null => {
    if (!s) return null
    const m = s.match(re)
    if (!m) return null
    return [parseInt(m[1], 10), parseInt(m[2], 10)]
  }
  let start = parse(from)
  let end = parse(to)
  if (!start && !end) return []
  if (start && !end) end = [start[0] + 1, start[1]]
  if (end && !start) start = [end[0] - 1, end[1]]
  const out: string[] = []
  const yearsIncluded = new Set<number>()
  let [y, m] = start!
  const [ey, em] = end!
  while (out.length < MAX) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    yearsIncluded.add(y)
    if (y > ey || (y === ey && m >= em)) break
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  // Also include bare YYYY strings so questions with year-only dates match
  for (const yr of yearsIncluded) {
    out.push(String(yr))
  }
  return out
}

function parseCsv(value: string | null): string[] {
  if (!value) return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

function parseIdsCsv(value: string | null): number[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n))
}

/**
 * Apply all filters uniformly to a Supabase query builder.
 * Used by both count and data queries so they stay in sync.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, p: FilterParams) {
  query = applyExamSourceFilter(query, p.examSource)
  // topics (plural) takes precedence over topic (singular)
  if (p.topics.length > 0) {
    query = query.in('topic', p.topics)
  } else if (p.topic && p.topic !== 'random') {
    query = query.eq('topic', p.topic)
  }
  if (p.part && VIENNA_EXAM_PARTS[p.part]) {
    query = query.in('topic', VIENNA_EXAM_PARTS[p.part])
  }
  // tags (plural, AND) takes precedence over tag (singular)
  if (p.tags.length > 0) {
    query = query.contains('tags', p.tags)
  } else if (p.tag) {
    query = query.contains('tags', [p.tag])
  }
  if (p.ids.length > 0) {
    query = query.in('id', p.ids)
  }
  // Exclude already-seen questions (used by quiz to avoid repeats).
  // Defense-in-depth: filter to integers only before string-
  // concatenating into the PostgREST filter — parseIdsCsv already
  // does this, but we want the guarantee at the point of use so a
  // future sanitizer loosening can't introduce a SQL injection path
  // (Backend audit BE-P2-019).
  if (p.excludeIds.length > 0) {
    const safeIds = p.excludeIds.filter((n) => Number.isInteger(n) && n >= 0)
    if (safeIds.length > 0) {
      query = query.not('id', 'in', `(${safeIds.join(',')})`)
    }
  }
  if (p.examDateFrom || p.examDateTo) {
    const months = buildMonthRange(p.examDateFrom, p.examDateTo)
    if (months.length > 0) query = query.overlaps('exam_dates', months)
  }
  if (p.search) {
    // Escape % and , to minimize .or() parsing breakage
    const safe = p.search.replace(/[,%]/g, ' ')
    query = query.or(`question.ilike.%${safe}%,answer.ilike.%${safe}%`)
  }
  // Exam year filter — matches questions whose exam_dates array contains any YYYY-MM starting with this year
  if (p.examYear && /^\d{4}$/.test(p.examYear)) {
    // Generate all 12 months for the year and check overlap
    const yearMonths = Array.from({ length: 12 }, (_, i) =>
      `${p.examYear}-${String(i + 1).padStart(2, '0')}`)
    yearMonths.push(p.examYear!) // also match bare "YYYY" entries
    query = query.overlaps('exam_dates', yearMonths)
  }
  return query
}

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const sp = req.nextUrl.searchParams

  const rawLimit = sp.get('limit')
  const parsedLimit = Number.parseInt(rawLimit || '1', 10)
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 200)) : 1
  const listMode = sp.get('list') === '1'
  const listOffset = Math.max(0, Number.parseInt(sp.get('offset') || '0', 10) || 0)
  const limitExplicit = rawLimit !== null
  const countOnlyRaw = sp.get('countOnly')
  const countOnly = countOnlyRaw === '1' || countOnlyRaw === 'true'

  const mcqOnly = sp.get('mcqOnly') === '1' || sp.get('mcqOnly') === 'true'
  // UX-PRA-64: /flashcards asks for recall-able cards only. Applied on the
  // review-due and random paths (the ones /flashcards uses); a batch is read
  // so a run of multi-answer rows never ends in a false "Alles wiederholt".
  const flashcardMode = sp.get('flashcard') === '1'
  const cardBatch = flashcardMode ? Math.min(30, Math.max(limit * 8, 8)) : limit

  const filters: FilterParams = {
    examSource: sp.get('examSource') || DEFAULT_EXAM_SOURCE,
    topic: sp.get('topic'),
    topics: parseCsv(sp.get('topics')),
    part: sp.get('part') as 'sip4' | 'sip5' | null,
    tag: sp.get('tag'),
    tags: parseCsv(sp.get('tags')),
    search: sp.get('search'),
    ids: parseIdsCsv(sp.get('ids')),
    excludeIds: parseIdsCsv(sp.get('excludeIds')),
    examDateFrom: sp.get('examDateFrom'),
    examDateTo: sp.get('examDateTo'),
    practiceMode: (sp.get('practiceMode') as 'all' | 'unseen' | 'wrong' | 'review') || 'all',
    examYear: sp.get('examYear'),
  }

  // ── Free-tier gating (Lock 2026-04-23) ───────────────────────────
  // Resolve the caller's tier from the verified session token (S-1).
  // Unauthenticated guests are treated as free. Admin + active-Pro pass
  // through unchanged.
  //
  // Free-tier rules:
  //   - practiceMode='review' (spaced repetition) → 402
  //   - practiceMode='wrong'  (requires full history) → 402
  //   - all other fetches are INTERSECTED with the 150-question free
  //     slice for the requested exam_type. When the intersection is
  //     empty (free user has exhausted the slice), we return
  //     { paywallHit: true, seen, limit } as a 200 so the client can
  //     render the upgrade prompt.
  const authed = await resolveTier(req, sb)
  const userId = authed.userId
  // 2026-04-24: admin role overrides tier. /admin/ operators (role='admin'
  // but possibly tier='free' if they never subscribed) bypass the 150Q
  // free-slice gate so they can audit question content unconstrained.
  const free = authed.role === 'admin' ? false : isFreeTier(authed.tier, authed.tierExpiresAt)

  if (free) {
    // Pro-only practice modes come from the entitlements matrix (UX-GLOBAL-19,
    // pick-free-features A); respond 402 so the UI can open its gate in place.
    const gatedFeature = featureForPracticeMode(filters.practiceMode)
    if (gatedFeature && !canUse(gatedFeature, authed.userId ? 'free' : 'guest')) {
      const gate = FEATURE_GATE[gatedFeature] ?? 'qbank_limit'
      await logFreeCapHit(sb, {
        userId: authed.userId,
        gate,
        route: '/api/questions',
        examType: filters.examSource || null,
        surface: 'quiz',
        trigger: 'practice_mode',
      })
      return NextResponse.json(
        {
          error: 'Pro only',
          upgradeRequired: true,
          gate,
        },
        { status: 402 }
      )
    }
  }

  // Personal modes must never degrade to random questions when identity or
  // history is unavailable. resolveTier fails closed during DB/auth errors.
  if (['unseen', 'wrong', 'review'].includes(filters.practiceMode) && !authed.userId) {
    return NextResponse.json({ error: 'Your study history could not be verified. Please retry.' }, { status: 503 });
  }

  // Helper: apply mcqOnly filter (questions must have structured choices JSONB, not null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withMcq = (q: any) => mcqOnly ? q.not('choices', 'is', null) : q

  // The exam_type a free request resolves to. The free gate is always
  // per-exam-type: a user at 150/150 on Kenntnisprüfung must still get
  // Pharma. 'all'/unset falls back to the default exam so we never ship
  // free users an unbounded cross-exam result.
  const resolveFreeExam = (): string =>
    filters.examSource && filters.examSource !== 'all'
      ? filters.examSource === 'SIP'
        ? 'kenntnispruefung'
        : filters.examSource
      : DEFAULT_EXAM_SOURCE

  // 2026-10-02: every free-quota wall now leaves a server event
  // (`paywall_hit`, throttled per user/exam/hour); it was invisible.
  const capHitResponse = async (body: Record<string, unknown>) => {
    await logFreeCapHit(sb, {
      userId: authed.userId,
      gate: 'qbank_limit',
      route: '/api/questions',
      examType: resolveFreeExam(),
      seen: typeof body.seen === 'number' ? body.seen : null,
    })
    return NextResponse.json(body)
  }

  // Helper: the 150-question free slice for the current exam. Used only
  // when `free` is true. Returns null when the slice could not be loaded
  // (after one retry and with no cached copy): callers answer with
  // `sliceUnavailable()` (503, the client shows its retry state) instead
  // of treating an unreadable slice as an exhausted allowance (paywall).
  const getFreeSliceForExam = async (): Promise<number[] | null> => {
    const result = await loadFreeSliceIds(sb, resolveFreeExam())
    return result.ok ? result.ids : null
  }
  const sliceUnavailable = () =>
    NextResponse.json(
      { error: 'Questions are temporarily unavailable. Please retry.', retryable: true },
      { status: 503 }
    )

  // ── Durable free-tier cap (2026-06-20, behind FREE_TIER_ENFORCED) ──
  // A free user who has ANSWERED ≥150 distinct questions in this exam
  // type (counted cross-device from answer_history) is capped: NEW/unseen
  // questions are walled. This is layered ON TOP of the slice — the slice
  // still defines WHICH 150 they draw, this makes the wall fire durably
  // (the client `seenIdsRef` was in-memory and reset on reload).
  //
  // Returns null when the cap does not apply (flag off, guest with no
  // userId, not free, or under the cap). Returns { seen } when capped so
  // the caller can emit a paywallHit with an honest count.
  //
  // Guests (userId === null) can't be cap-counted (no durable identity),
  // so they keep the slice-only behaviour — the slice already bounds them
  // to 150 questions and the landing demo must stay frictionless.
  const checkDurableCap = async (): Promise<{ seen: number } | null> => {
    if (!free) return null
    if (!isFreeTierEnforced()) return null
    if (!authed.userId) return null
    const answered = await countDistinctAnsweredInExam(
      sb,
      authed.userId,
      resolveFreeExam()
    )
    if (answered >= FREE_TIER_QUESTIONS_PER_EXAM) {
      return { seen: Math.min(answered, FREE_TIER_QUESTIONS_PER_EXAM) }
    }
    return null
  }

  // countOnly short-circuit — returns { count } without question payloads.
  // For free users, the "count" is capped at the intersection of the
  // caller's filters with the free slice, so UI counts don't promise
  // thousands of questions that the free user can't actually draw.
  if (countOnly) {
    let cq = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
    cq = applyFilters(cq, filters)
    cq = withMcq(cq)
    if (free) {
      const slice = await getFreeSliceForExam()
      if (slice === null) return sliceUnavailable()
      if (slice.length === 0) {
        return NextResponse.json({ count: 0, freeTier: true })
      }
      // Durable cap: a capped free user has consumed their allowance, so
      // the available-NEW count is 0. Report it honestly (with capped:true)
      // so the UI can render "150/150" rather than promising more.
      const capped = await checkDurableCap()
      if (capped) {
        return capHitResponse({
          count: 0,
          freeTier: true,
          capped: true,
          seen: capped.seen,
          limit: FREE_TIER_QUESTIONS_PER_EXAM,
        })
      }
      cq = cq.in('id', slice)
    }
    const { count, error } = await cq
    if (error) {
      captureServerError(error, { route: '/api/questions', phase: 'select' })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({
      count: count || 0,
      ...(free ? { freeTier: true, limit: FREE_TIER_QUESTIONS_PER_EXAM } : {}),
    })
  }

  // Explicit selection mode (ids) returns matching questions directly, skipping spaced-rep.
  // For free users we intersect requested ids with the free slice — a free user
  // linking to a question id they're not allowed to see gets nothing.
  if (filters.ids.length > 0) {
    if (free) {
      const slice = await getFreeSliceForExam()
      if (slice === null) return sliceUnavailable()
      const sliceSet = new Set(slice)
      filters.ids = filters.ids.filter((id) => sliceSet.has(id))
      // Durable cap: a capped free user keeps READ access to questions
      // they've already answered (re-read + cached AI explanation), but
      // a deep-link to an unseen slice id must NOT let them consume new
      // content past the cap. So when capped, restrict to answered ids.
      const capped = await checkDurableCap()
      if (capped) {
        const answered = await getAnsweredSliceIds(sb, authed.userId!, slice)
        filters.ids = filters.ids.filter((id) => answered.has(id))
      }
      if (filters.ids.length === 0) {
        return capHitResponse({
          paywallHit: true,
          seen: 0,
          limit: FREE_TIER_QUESTIONS_PER_EXAM,
        })
      }
    }
    let q = sb.from('questions').select('*').eq('is_active', true)
    q = applyFilters(q, filters)
    q = withMcq(q)
    // When no explicit limit is passed, return all matching ids (capped at 500).
    const effectiveLimit = limitExplicit ? limit : filters.ids.length
    const { data, error } = await q.limit(Math.min(effectiveLimit, 500))
    if (error) {
      captureServerError(error, { route: '/api/questions', phase: 'select' })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(attachOptions(data || []))
  }

  // New-question mode selects from the learner's distinct unseen pool in
  // Postgres. Do not serialize the full answer history into a REST filter:
  // deep histories otherwise exceed URL limits and old questions return.
  if (['unseen', 'wrong', 'review'].includes(filters.practiceMode) && userId && !userId.startsWith('guest_')) {
    let topics = filters.topics.length > 0
      ? filters.topics
      : filters.topic && filters.topic !== 'random'
        ? [filters.topic]
        : null
    if (filters.part && VIENNA_EXAM_PARTS[filters.part]) {
      const partTopics = VIENNA_EXAM_PARTS[filters.part]
      topics = topics ? topics.filter((topic) => partTopics.includes(topic)) : partTopics
    }
    const tags = filters.tags.length > 0 ? filters.tags : filters.tag ? [filters.tag] : null
    const examDates = filters.examDateFrom || filters.examDateTo
      ? buildMonthRange(filters.examDateFrom, filters.examDateTo)
      : null
    const examYear = filters.examYear && /^\d{4}$/.test(filters.examYear)
      ? [...Array.from({ length: 12 }, (_, i) => `${filters.examYear}-${String(i + 1).padStart(2, '0')}`), filters.examYear]
      : null
    const normalizedExam = filters.examSource === 'SIP' ? 'kenntnispruefung' : filters.examSource
    const examTypes = free
      ? [resolveFreeExam()]
      : !normalizedExam || normalizedExam === 'all'
        ? EXAM_SOURCE_IDS
        : [EXAM_SOURCE_IDS.includes(normalizedExam as (typeof EXAM_SOURCE_IDS)[number]) ? normalizedExam : DEFAULT_EXAM_SOURCE]
    let allowedIds: number[] | null = null
    if (free) {
      allowedIds = await getFreeSliceForExam()
      if (allowedIds === null) return sliceUnavailable()
      if (allowedIds.length === 0) return capHitResponse({ paywallHit: true, seen: 0, limit: FREE_TIER_QUESTIONS_PER_EXAM })
      const capped = await checkDurableCap()
      if (capped) return capHitResponse({ paywallHit: true, seen: capped.seen, limit: FREE_TIER_QUESTIONS_PER_EXAM })
    }

    // UX-PRA-55: "Meine Fehler wiederholen" practises open mistakes only
    // (?open=1), from the same rule as /mistakes. Before the a23 changeset
    // is applied the all-time wrong pool below answers instead.
    if (filters.practiceMode === 'wrong' && sp.get('open') === '1' && !listMode) {
      const { data: openRows, error: openError } = await sb.rpc('get_mistake_rows', {
        p_user_id: userId,
        p_exam_types: examTypes,
        p_topics: topics,
        p_state: 'open',
        p_offset: 0,
        p_limit: 200,
      })
      if (openError && !isMissingRuleError(openError)) {
        captureServerError(openError, { route: '/api/questions', phase: 'open-mistakes' })
        return NextResponse.json({ error: 'Could not load your mistakes. Please retry.' }, { status: 503 })
      }
      if (!openError) {
        const excluded = new Set(filters.excludeIds)
        const openIds = ((openRows || []) as { question_id: number; is_active: boolean | null }[])
          .filter((row) => row.is_active !== false && !excluded.has(Number(row.question_id)))
          .map((row) => Number(row.question_id))
          .slice(0, Math.min(limit, 200))
        if (openIds.length === 0) return NextResponse.json([])
        let openQuery = sb.from('questions').select('*').in('id', openIds).eq('is_active', true)
        openQuery = applyFilters(openQuery, filters)
        openQuery = withMcq(openQuery)
        const { data, error } = await openQuery
        if (error) {
          captureServerError(error, { route: '/api/questions', phase: 'open-mistakes-select' })
          return NextResponse.json({ error: 'Could not load your mistakes. Please retry.' }, { status: 503 })
        }
        const order = new Map(openIds.map((id, index) => [id, index]))
        const ordered = (data || []).sort((a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0))
        return NextResponse.json(attachOptions(ordered))
      }
    }

    const { data: candidateRows, error: candidateError } = await sb.rpc(
      'get_study_question_ids',
      {
        p_user_id: userId,
        p_mode: filters.practiceMode,
        p_offset: listMode ? listOffset : 0,
        p_exam_types: examTypes,
        p_topics: topics,
        p_tags: tags,
        p_exam_dates: examDates,
        p_exam_year: examYear,
        p_search: filters.search,
        p_mcq_only: mcqOnly,
        p_exclude_ids: filters.excludeIds,
        p_allowed_ids: allowedIds,
        p_limit: Math.min(limit, 200),
      },
    )
    if (candidateError) {
      captureServerError(candidateError, { route: '/api/questions', phase: 'unseen-history' })
      return NextResponse.json({ error: 'Could not load your question history. Please retry.' }, { status: 503 })
    }
    const candidateIds: number[] = ((candidateRows || []) as { question_id: number }[])
      .map((row) => Number(row.question_id))
    if (candidateIds.length === 0) {
      return NextResponse.json([])
    }
    let unseenQuery = sb.from('questions').select('*').in('id', candidateIds)
    unseenQuery = applyFilters(unseenQuery, filters)
    unseenQuery = withMcq(unseenQuery)
    const { data, error } = await unseenQuery.limit(Math.min(limit, 200))
    if (error) {
      captureServerError(error, { route: '/api/questions', phase: 'unseen-select' })
      return NextResponse.json({ error: 'Could not load an unseen question. Please retry.' }, { status: 503 })
    }
    const order = new Map(candidateIds.map((id, index) => [id, index]))
    const orderedData = (data || []).sort(
      (a, b) => (order.get(Number(a.id)) ?? 0) - (order.get(Number(b.id)) ?? 0),
    )
    return NextResponse.json(attachOptions(orderedData))
  }

  // Search mode: text search across question + answer columns. This follows
  // practice-mode filtering so unseen + search and wrong + search retain the
  // requested history rule.
  if (filters.search) {
    let query = sb.from('questions').select('*').eq('is_active', true)
    query = applyFilters(query, filters)
    query = withMcq(query)
    if (free) {
      let slice = await getFreeSliceForExam()
      if (slice === null) return sliceUnavailable()
      if (slice.length === 0) return NextResponse.json([])
      const capped = await checkDurableCap()
      if (capped) {
        const answered = await getAnsweredSliceIds(sb, authed.userId!, slice)
        slice = slice.filter((id) => answered.has(id))
        if (slice.length === 0) return NextResponse.json([])
      }
      query = query.in('id', slice)
    }
    const { data, error } = await query.limit(Math.min(limit, 30))
    if (error) {
      captureServerError(error, { route: '/api/questions', phase: 'select' })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(attachOptions(data || []))
  }

  // If real user (not guest) AND Pro, prioritize spaced-repetition review
  // questions — but still respect topic/part/mcqOnly filters so the user
  // gets reviews from the subject they selected, not random other topics.
  //
  // Free users are skipped here entirely. Their practiceMode='review' is
  // already 402'd above; for practiceMode='all' we don't interject with
  // SR-due questions because the spaced-rep scheduler is itself a Pro
  // feature.
  let reviewSkipped: { skippedIds: number[]; skipped: { multi: number; option_dependent: number } } | null = null
  if (filters.practiceMode === 'all' && userId && !userId.startsWith('guest_') && !free) {
    const reviewQuery = sb
      .from('user_question_progress')
      .select('question_id')
      .eq('user_id', userId)
      .lte('next_review_at', new Date().toISOString())
      .limit(cardBatch)

    const { data: progress } = await reviewQuery

    if (progress && progress.length > 0) {
      const reviewIds = progress.map((p) => p.question_id)
      let q = sb.from('questions').select('*').in('id', reviewIds).eq('is_active', true)
      q = applyFilters(q, filters)
      q = withMcq(q)
      const { data } = await q
      if (data && data.length > 0) {
        if (!flashcardMode) return NextResponse.json(attachOptions(data))
        const split = splitFlashcards(attachOptions(data))
        if (split.cards.length > 0) return flashcardResponse(split.cards.slice(0, limit), split)
        // Every due card needs its options: report them with the random batch
        // so the page excludes them instead of re-reading them each time.
        reviewSkipped = split
      }
    }
  }

  // Get count for random offset. Free-tier users only draw from the
  // 150-question slice, so we count + range within it.
  let countQuery = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
  countQuery = applyFilters(countQuery, filters)
  countQuery = withMcq(countQuery)
  let freeSliceIds: number[] | null = null
  if (free) {
    freeSliceIds = await getFreeSliceForExam()
    if (freeSliceIds === null) return sliceUnavailable()
    if (freeSliceIds.length === 0) {
      return capHitResponse({
        paywallHit: true,
        seen: 0,
        limit: FREE_TIER_QUESTIONS_PER_EXAM,
      })
    }
    // Durable cap: a free user who has answered ≥150 distinct in this
    // exam type is walled from NEW questions. The random path always
    // serves a fresh/unseen question, so when capped we wall here. (A
    // free user can still RE-READ an already-answered question via the
    // explicit-ids path below — that branch serves answered ids.)
    const capped = await checkDurableCap()
    if (capped) {
      return capHitResponse({
        paywallHit: true,
        seen: capped.seen,
        limit: FREE_TIER_QUESTIONS_PER_EXAM,
      })
    }
    countQuery = countQuery.in('id', freeSliceIds)
  }
  const { count, error: countError } = await countQuery
  // A failed or timed-out count must not read as "nothing left": for a free
  // learner that path below answers with a paywall.
  if (countError) {
    captureServerError(countError, { route: '/api/questions', phase: 'random-count' })
    return NextResponse.json(
      { error: 'Questions are temporarily unavailable. Please retry.', retryable: true },
      { status: 503 }
    )
  }

  if (!count) {
    // A free user whose excludeIds has covered every allowed question
    // — that's a paywall hit, not a null result. We report how many
    // they've already seen (best-effort: the slice size minus the
    // non-excluded-within-slice count) so the client can show
    // "150/150" or similar.
    if (free && freeSliceIds && freeSliceIds.length > 0) {
      const excludedInSlice = filters.excludeIds.filter((id) =>
        freeSliceIds!.includes(id)
      ).length
      return capHitResponse({
        paywallHit: true,
        seen: Math.min(excludedInSlice, FREE_TIER_QUESTIONS_PER_EXAM),
        limit: FREE_TIER_QUESTIONS_PER_EXAM,
      })
    }
    return NextResponse.json([])
  }

  const randomBatch = async (size: number) => {
    const offset = Math.floor(Math.random() * Math.max(1, count - size))
    let query = sb.from('questions').select('*').eq('is_active', true)
    query = applyFilters(query, filters)
    query = withMcq(query)
    if (free && freeSliceIds) {
      query = query.in('id', freeSliceIds)
    }
    return query.range(offset, offset + size - 1)
  }

  if (flashcardMode) {
    // Up to three random batches; the skipped ids come back so the page adds
    // them to excludeIds and never pays a round trip per skipped card.
    const total = {
      cards: [] as Record<string, unknown>[],
      skippedIds: [...(reviewSkipped?.skippedIds ?? [])],
      skipped: { multi: reviewSkipped?.skipped.multi ?? 0, option_dependent: reviewSkipped?.skipped.option_dependent ?? 0 },
    }
    for (let attempt = 0; attempt < 3 && total.cards.length === 0; attempt += 1) {
      const { data, error } = await randomBatch(cardBatch)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const split = splitFlashcards(attachOptions(data || []))
      total.cards = split.cards
      for (const id of split.skippedIds) if (!total.skippedIds.includes(id)) total.skippedIds.push(id)
      total.skipped.multi += split.skipped.multi
      total.skipped.option_dependent += split.skipped.option_dependent
      if (count <= cardBatch) break
    }
    return flashcardResponse(total.cards.slice(0, limit), total)
  }

  const { data, error } = await randomBatch(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(attachOptions(data || []))
}

/** Flashcard batch: the cards plus what the eligibility rules removed. */
function flashcardResponse(
  cards: Record<string, unknown>[],
  split: { skippedIds: number[]; skipped: { multi: number; option_dependent: number } },
) {
  const res = NextResponse.json(cards)
  res.headers.set(FLASHCARD_HEADERS.skippedIds, split.skippedIds.slice(0, 100).join(','))
  res.headers.set(FLASHCARD_HEADERS.multi, String(split.skipped.multi))
  res.headers.set(FLASHCARD_HEADERS.optionDependent, String(split.skipped.option_dependent))
  if (split.skippedIds.length > 0) {
    console.info('[questions] flashcard eligibility skipped', split.skipped)
  }
  return res
}

/** Attach shuffled MCQ options + n_correct to each question. image_url comes from DB. */
function attachOptions(questions: Record<string, unknown>[]) {
  return questions.map((q) => {
    const answer = (q.answer as string) || ''
    const topic = (q.topic as string) || ''
    const question = (q.question as string) || ''
    const storedDistractors = (q.distractors as string[]) || []
    const storedChoices = q.choices as StoredChoice[] | null | undefined

    let options
    let nCorrect = 0
    if (Array.isArray(storedChoices) && storedChoices.length >= 2) {
      // New path: structured choices from Anki re-import (preserves multi-correct)
      // Placeholder options are hidden at render time (see filterDisplayableChoices).
      // n_correct MUST be derived from the same filtered set the user actually
      // sees, otherwise a multi-select question can demand more correct answers
      // than there are options on screen and become unanswerable.
      options = buildMCQFromChoices(storedChoices)
      nCorrect = filterDisplayableChoices(storedChoices).filter(c => c.correct).length
    } else if (storedDistractors.length >= 3) {
      // Legacy path: single correct + stored distractors
      options = buildMCQFromStored(answer, storedDistractors)
      nCorrect = 1
    } else {
      const wrong = generateWrongOptions(question, answer, topic)
      options = buildMCQOptions(answer, wrong)
      nCorrect = options ? 1 : 0
    }

    // options: null → open-answer mode
    return { ...q, options, n_correct: nCorrect }
  })
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()
  const { action, examSource } = body

  if (action === 'topics') {
    // Use the get_topic_counts() RPC function to bypass the Supabase REST
    // 1000-row limit. The function does GROUP BY server-side and returns
    // at most ~15 rows (one per topic). Cached 1 h per instance
    // (getTopicCountsCached, 2026-10-10).
    const normalized = !examSource || examSource === 'SIP'
      ? DEFAULT_EXAM_SOURCE
      : examSource

    const { data, error } = await getTopicCountsCached(
      sb,
      normalized === 'all' ? null : normalized
    )

    if (error) {
      captureServerError(error, { route: '/api/questions', method: 'POST', phase: 'topics-rpc' })
      return NextResponse.json([], { status: 500 })
    }

    const results = (data || [])
      .filter((r: { topic: string; count: number }) => r.count > 0)
      .map((r: { topic: string; count: number }) => ({ topic: r.topic, count: Number(r.count) }))

    return NextResponse.json(results)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
