import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { generateWrongOptions, buildMCQOptions, buildMCQFromStored, buildMCQFromChoices } from '@/lib/mcq'
import type { StoredChoice } from '@/lib/mcq'
import { VIENNA_EXAM_PARTS, DEFAULT_EXAM_SOURCE, EXAM_SOURCE_IDS } from '@/lib/topics'

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
  const limit = rawLimit ? parseInt(rawLimit) : 1
  const limitExplicit = rawLimit !== null
  const userId = sp.get('userId')
  const countOnlyRaw = sp.get('countOnly')
  const countOnly = countOnlyRaw === '1' || countOnlyRaw === 'true'

  const mcqOnly = sp.get('mcqOnly') === '1' || sp.get('mcqOnly') === 'true'

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

  // Helper: apply mcqOnly filter (questions must have structured choices JSONB, not null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withMcq = (q: any) => mcqOnly ? q.not('choices', 'is', null) : q

  // countOnly short-circuit — returns { count } without question payloads
  if (countOnly) {
    let cq = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
    cq = applyFilters(cq, filters)
    cq = withMcq(cq)
    const { count, error } = await cq
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ count: count || 0 })
  }

  // Explicit selection mode (ids) returns matching questions directly, skipping spaced-rep
  if (filters.ids.length > 0) {
    let q = sb.from('questions').select('*').eq('is_active', true)
    q = applyFilters(q, filters)
    q = withMcq(q)
    // When no explicit limit is passed, return all matching ids (capped at 500).
    const effectiveLimit = limitExplicit ? limit : filters.ids.length
    const { data, error } = await q.limit(Math.min(effectiveLimit, 500))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(attachOptions(data || []))
  }

  // Search mode: text search across question + answer columns
  if (filters.search) {
    let query = sb.from('questions').select('*').eq('is_active', true)
    query = applyFilters(query, filters)
    query = withMcq(query)
    const { data, error } = await query.limit(Math.min(limit, 30))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(attachOptions(data || []))
  }

  // ── Practice mode: unseen / wrong ──
  // These modes query answer_history to build inclusion/exclusion lists,
  // then fall through to the normal random-fetch below.
  if (filters.practiceMode !== 'all' && userId && !userId.startsWith('guest_')) {
    if (filters.practiceMode === 'wrong') {
      // Fetch question IDs the user answered incorrectly (ever)
      const { data: wrongRows } = await sb
        .from('answer_history')
        .select('question_id')
        .eq('user_id', userId)
        .eq('is_correct', false)
        .limit(5000)
      if (wrongRows && wrongRows.length > 0) {
        const wrongIds = [...new Set(wrongRows.map(r => r.question_id))]
        // Override filters to only include these IDs
        filters.ids = wrongIds
      } else {
        return NextResponse.json([]) // no wrong answers yet
      }
    } else if (filters.practiceMode === 'unseen') {
      // Fetch question IDs the user has already answered (any result)
      const { data: seenRows } = await sb
        .from('answer_history')
        .select('question_id')
        .eq('user_id', userId)
        .limit(50000)
      if (seenRows && seenRows.length > 0) {
        const seenIds = [...new Set(seenRows.map(r => r.question_id))]
        // Add to excludeIds so only unseen questions are returned
        filters.excludeIds = [...filters.excludeIds, ...seenIds]
      }
    }
    // Fall through to normal fetch with the updated filters
  }

  // If real user (not guest), prioritize spaced-repetition review questions
  // — but still respect topic/part/mcqOnly filters so the user gets reviews
  // from the subject they selected, not random other topics
  if (userId && !userId.startsWith('guest_')) {
    const reviewQuery = sb
      .from('user_question_progress')
      .select('question_id')
      .eq('user_id', userId)
      .lte('next_review_at', new Date().toISOString())
      .limit(limit)

    const { data: progress } = await reviewQuery

    if (progress && progress.length > 0) {
      const reviewIds = progress.map((p) => p.question_id)
      let q = sb.from('questions').select('*').in('id', reviewIds).eq('is_active', true)
      q = applyFilters(q, filters)
      q = withMcq(q)
      const { data } = await q
      if (data && data.length > 0) return NextResponse.json(attachOptions(data))
    }
  }

  // Get count for random offset
  let countQuery = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
  countQuery = applyFilters(countQuery, filters)
  countQuery = withMcq(countQuery)
  const { count } = await countQuery

  if (!count) return NextResponse.json([])

  const offset = Math.floor(Math.random() * Math.max(1, count - limit))

  let query = sb.from('questions').select('*').eq('is_active', true)
  query = applyFilters(query, filters)
  query = withMcq(query)
  const { data, error } = await query.range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(attachOptions(data || []))
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
      options = buildMCQFromChoices(storedChoices)
      nCorrect = storedChoices.filter(c => c.correct).length
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
    // at most ~15 rows (one per topic).
    const normalized = !examSource || examSource === 'SIP'
      ? DEFAULT_EXAM_SOURCE
      : examSource

    const { data, error } = await sb.rpc('get_topic_counts', {
      p_exam_type: normalized === 'all' ? null : normalized,
    })

    if (error) {
      console.error('[topics RPC error]', error)
      return NextResponse.json([], { status: 500 })
    }

    const results = (data || [])
      .filter((r: { topic: string; count: number }) => r.count > 0)
      .map((r: { topic: string; count: number }) => ({ topic: r.topic, count: Number(r.count) }))

    return NextResponse.json(results)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
