import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { generateWrongOptions, buildMCQOptions } from '@/lib/mcq'

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const topic = req.nextUrl.searchParams.get('topic')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '1')
  const userId = req.nextUrl.searchParams.get('userId')

  // If real user (not guest), prioritize spaced-repetition review questions
  if (userId && !userId.startsWith('guest_')) {
    const { data: progress } = await sb
      .from('user_question_progress')
      .select('question_id')
      .eq('user_id', userId)
      .lte('next_review_at', new Date().toISOString())
      .limit(limit)

    if (progress && progress.length > 0) {
      const ids = progress.map(p => p.question_id)
      const { data } = await sb.from('questions').select('*').in('id', ids)
      if (data && data.length > 0) return NextResponse.json(attachOptions(data))
    }
  }

  // Get count for random offset
  const countQuery = sb.from('questions').select('id', { count: 'exact', head: true }).eq('is_active', true)
  if (topic && topic !== 'random') {
    countQuery.eq('topic', topic)
  }
  const { count } = await countQuery

  if (!count) return NextResponse.json([])

  const offset = Math.floor(Math.random() * Math.max(1, count - limit))

  let query = sb.from('questions').select('*').eq('is_active', true)
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

    // Heuristic: questions mentioning imaging/visual findings likely have images
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
  const { action } = await req.json()

  if (action === 'topics') {
    // Use individual count queries per known topic to avoid row limit issues
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

    const results = await Promise.all(
      knownTopics.map(async (topic) => {
        const { count } = await sb
          .from('questions')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .eq('topic', topic)
        return { topic, count: count || 0 }
      })
    )

    return NextResponse.json(
      results.filter(r => r.count > 0).sort((a, b) => b.count - a.count)
    )
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
