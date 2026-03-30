import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const topic = req.nextUrl.searchParams.get('topic')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '1')
  const userId = req.nextUrl.searchParams.get('userId')

  // If user provided, prioritize questions due for review
  if (userId) {
    const { data: progress } = await sb
      .from('user_question_progress')
      .select('question_id')
      .eq('user_id', userId)
      .lte('next_review_at', new Date().toISOString())
      .limit(limit)

    if (progress && progress.length > 0) {
      const ids = progress.map(p => p.question_id)
      const { data } = await sb.from('questions').select('*').in('id', ids)
      if (data && data.length > 0) return NextResponse.json(data)
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
  return NextResponse.json(data || [])
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
