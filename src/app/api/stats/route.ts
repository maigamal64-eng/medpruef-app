import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stats — returns per-user gamification + per-topic accuracy.
 *
 * SECURITY: gated by `requireUser`. The body/query userId is IGNORED
 * — the caller's identity comes from the auth-guard verified
 * x-user-id header. This closes SEC-LAUNCH-01 (discovered 2026-04-22
 * during launch-readiness audit): previously anyone with a user's
 * UUID could read their gamification snapshot + per-topic mastery
 * by calling /api/stats?userId=<uuid> unauthenticated. Same pattern
 * as /api/user/topic-progress and /api/user/topic-strength.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  const sb = getServiceClient()

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
