import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/topic-progress?examType=...
 *
 * Returns per-topic progress for the authenticated user:
 *   { topic, total, answered, correct, wrong, accuracy }
 *
 * Auth: requireUser — userId comes from the session header, not the
 * query string. Previously this endpoint accepted `?userId=<uuid>`
 * and returned any user's progress (BE-P1-012 in the 2026-04-15 audit).
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  try {
    const sp = req.nextUrl.searchParams
    const examType = sp.get('examType') || 'kenntnispruefung'

    const sb = getServiceClient()

    // Get total questions per topic for this exam type
    const { data: topicCounts } = await sb.rpc('get_topic_counts', {
      p_exam_type: examType,
    })

    // Get per-topic answer stats from answer_history
    // We join answer_history → questions to get the topic
    const { data: answerStats } = await sb
      .from('answer_history')
      .select('question_id, is_correct, questions!inner(topic, exam_type)')
      .eq('user_id', userId)
      .eq('questions.exam_type' as string, examType)
      .limit(50000)

    if (!answerStats || !topicCounts) {
      return NextResponse.json(
        (topicCounts || []).map((t: { topic: string; count: number }) => ({
          topic: t.topic,
          total: Number(t.count),
          answered: 0,
          correct: 0,
          wrong: 0,
          accuracy: 0,
        }))
      )
    }

    // Aggregate per topic
    const stats: Record<string, { answered: Set<number>; correct: Set<number>; wrong: Set<number> }> = {}
    for (const row of answerStats) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topic = (row as any).questions?.topic as string | undefined
      if (!topic) continue
      if (!stats[topic]) stats[topic] = { answered: new Set(), correct: new Set(), wrong: new Set() }
      stats[topic].answered.add(row.question_id)
      if (row.is_correct) {
        stats[topic].correct.add(row.question_id)
      } else {
        stats[topic].wrong.add(row.question_id)
      }
    }

    const result = (topicCounts as { topic: string; count: number }[]).map(tc => {
      const s = stats[tc.topic]
      const answered = s ? s.answered.size : 0
      const correct = s ? s.correct.size : 0
      const wrong = s ? s.wrong.size : 0
      return {
        topic: tc.topic,
        total: Number(tc.count),
        answered,
        correct,
        wrong,
        accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      }
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[topic-progress GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
