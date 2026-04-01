import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { generateWrongOptions, buildMCQOptions } from '@/lib/mcq'

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

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const topic = req.nextUrl.searchParams.get('topic')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '1')
  const userId = req.nextUrl.searchParams.get('userId')
  const examSource = req.nextUrl.searchParams.get('examSource') || 'SIP'

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
      const ids = progress.map(p => p.question_id)
      let q = sb.from('questions').select('*').in('id', ids)
      q = applyExamSourceFilter(q, examSource)
      const { data } = await q
      if (data && data.length > 0) return NextResponse.json(attachOptions(data))
    }
  }

  // Get count for random offset
  let countQuery = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
  countQuery = applyExamSourceFilter(countQuery, examSource)
  if (topic && topic !== 'random') {
    countQuery = countQuery.eq('topic', topic)
  }
  const { count } = await countQuery

  if (!count) return NextResponse.json([])

  const offset = Math.floor(Math.random() * Math.max(1, count - limit))

  let query = sb.from('questions').select('*').eq('is_active', true)
  query = applyExamSourceFilter(query, examSource)
  if (topic && topic !== 'random') {
    query = query.eq('topic', topic)
  }
  const { data, error } = await query.range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(attachOptions(data || []))
}

const IMAGE_KEYWORDS = ['Bild', 'Abbildung', 'Röntgen', 'EKG', 'CT', 'MRT', 'Befund']

/** Attach shuffled MCQ options and image_url to each question */
function attachOptions(questions: Record<string, unknown>[]) {
  return questions.map((q) => {
    const answer = (q.answer as string) || ''
    const topic = (q.topic as string) || ''
    const question = (q.question as string) || ''
    const wrong = generateWrongOptions(question, answer, topic)
    const options = buildMCQOptions(answer, wrong)

    const hasImageKeyword = IMAGE_KEYWORDS.some(
      (kw) => question.includes(kw) || answer.includes(kw)
    )
    const image_url = hasImageKeyword
      ? '/question-images/placeholder-medical.svg'
      : undefined

    return { ...q, options, ...(image_url ? { image_url } : {}) }
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
