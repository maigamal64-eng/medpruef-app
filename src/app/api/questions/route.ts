import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { generateWrongOptions, buildMCQOptions, buildMCQFromStored, buildMCQFromChoices } from '@/lib/mcq'
import type { StoredChoice } from '@/lib/mcq'
import { VIENNA_EXAM_PARTS } from '@/lib/topics'

/**
 * Apply exam source filter to a Supabase query builder.
 * KoalaMed questions are identified by source_file = 'KMP6a'/'KMP6b'/'KMP5b'.
 * SIP questions have source_file = original PDF file names (not starting with KMP).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyExamSourceFilter(query: any, examSource: string | null) {
  if (!examSource || examSource === 'all') return query
  if (examSource === 'SIP') return query.not('source_file', 'like', 'KMP%')
  // KMP5b / KMP6a / KMP6b
  return query.eq('source_file', examSource)
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
  examDateFrom: string | null
  examDateTo: string | null
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
  let [y, m] = start!
  const [ey, em] = end!
  while (out.length < MAX) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (y > ey || (y === ey && m >= em)) break
    m += 1
    if (m > 12) { m = 1; y += 1 }
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
  if (p.examDateFrom || p.examDateTo) {
    const months = buildMonthRange(p.examDateFrom, p.examDateTo)
    if (months.length > 0) query = query.overlaps('exam_dates', months)
  }
  if (p.search) {
    // Escape % and , to minimize .or() parsing breakage
    const safe = p.search.replace(/[,%]/g, ' ')
    query = query.or(`question.ilike.%${safe}%,answer.ilike.%${safe}%`)
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

  const filters: FilterParams = {
    examSource: sp.get('examSource') || 'SIP',
    topic: sp.get('topic'),
    topics: parseCsv(sp.get('topics')),
    part: sp.get('part') as 'sip4' | 'sip5' | null,
    tag: sp.get('tag'),
    tags: parseCsv(sp.get('tags')),
    search: sp.get('search'),
    ids: parseIdsCsv(sp.get('ids')),
    examDateFrom: sp.get('examDateFrom'),
    examDateTo: sp.get('examDateTo'),
  }

  // countOnly short-circuit — returns { count } without question payloads
  if (countOnly) {
    let cq = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
    cq = applyFilters(cq, filters)
    const { count, error } = await cq
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ count: count || 0 })
  }

  // Explicit selection mode (ids) returns matching questions directly, skipping spaced-rep
  if (filters.ids.length > 0) {
    let q = sb.from('questions').select('*').eq('is_active', true)
    q = applyFilters(q, filters)
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
    const { data, error } = await query.limit(Math.min(limit, 30))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(attachOptions(data || []))
  }

  // If real user (not guest), prioritize spaced-repetition review questions
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
      let q = sb.from('questions').select('*').in('id', reviewIds)
      q = applyExamSourceFilter(q, filters.examSource)
      const { data } = await q
      if (data && data.length > 0) return NextResponse.json(attachOptions(data))
    }
  }

  // Get count for random offset
  let countQuery = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
  countQuery = applyFilters(countQuery, filters)
  const { count } = await countQuery

  if (!count) return NextResponse.json([])

  const offset = Math.floor(Math.random() * Math.max(1, count - limit))

  let query = sb.from('questions').select('*').eq('is_active', true)
  query = applyFilters(query, filters)
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
    // For specific exam sources, fetch distinct topics dynamically
    if (examSource && examSource !== 'SIP' && examSource !== 'all') {
      // KoalaMed: get all distinct topics for this exam source
      const { data } = await sb
        .from('questions')
        .select('topic')
        .eq('source_file', examSource)
        .eq('is_active', true)

      if (!data) return NextResponse.json([])

      // Count per topic
      const counts: Record<string, number> = {}
      for (const row of data) {
        const t = row.topic as string
        counts[t] = (counts[t] || 0) + 1
      }

      const results = Object.entries(counts)
        .map(([topic, count]) => ({ topic, count }))
        .filter(r => r.count > 0)
        .sort((a, b) => b.count - a.count)

      return NextResponse.json(results)
    }

    // SIP or all: use known topic list with optional source filter
    const knownTopics = [
      'Chirurgische Fächer',
      'Dermatologie und Venerologie',
      'Innere Medizin',
      'Neurologie',
      'Psychiatrie',
      'Frauenheilkunde/Gynäkologie',
      'Kinder- und Jugendheilkunde',
      'Augenheilkunde',
      'Hals-Nasen-Ohrenheilkunde',
      'Notfall- und Intensivmedizin',
    ]

    // For "all", also include KoalaMed-specific topics
    const allTopics = examSource === 'all'
      ? [
          ...knownTopics,
          'Dermatologie',
          'Gynäkologie und Geburtshilfe',
          'HNO',
          'Kinder und Jugendheilkunde',
          'Kinder und Jugendpsychiatrie',
          'Intensivmedizin',
          'chirurgische Spezialfächer und Anästhesie',
          'Allgemeine Chirurgie',
        ]
      : knownTopics

    const results = await Promise.all(
      allTopics.map(async (topic) => {
        let q = sb
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .eq('topic', topic)
        q = applyExamSourceFilter(q, examSource || 'SIP')
        const { count } = await q
        return { topic, count: count || 0 }
      })
    )

    return NextResponse.json(
      results.filter(r => r.count > 0).sort((a, b) => b.count - a.count)
    )
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
