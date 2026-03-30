import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const sb = getServiceClient()
  const userId = req.nextUrl.searchParams.get('userId')

  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  // Get gamification
  const { data: gam } = await sb.from('user_gamification').select('*').eq('user_id', userId).single()
  
  // Get per-topic stats
  const { data: answers } = await sb
    .from('answer_history')
    .select('question_id, is_correct, questions(topic)')
    .eq('user_id', userId)

  const topicStats: Record<string, { total: number; correct: number }> = {}
  answers?.forEach((a: Record<string, unknown>) => {
    const topic = (a.questions as Record<string, string>)?.topic || 'Unknown'
    if (!topicStats[topic]) topicStats[topic] = { total: 0, correct: 0 }
    topicStats[topic].total++
    if (a.is_correct) topicStats[topic].correct++
  })

  return NextResponse.json({
    gamification: gam,
    topicStats,
  })
}
