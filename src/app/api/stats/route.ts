import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rate-limit'

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
// 60 req/min per user on /api/stats. Above this you're either abusing
// the endpoint or have a client bug — genuine dashboard polling sits
// at ~1/min. Leaves lots of headroom for a re-mount + a few refetches.
const STATS_RATE_LIMIT = { limit: 60, windowMs: 60_000 }

export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  const gate = checkRateLimit({
    key: rateKey('stats', userId),
    ...STATS_RATE_LIMIT,
  })
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: gate.retryAfterSec },
      { status: 429, headers: rateLimitHeaders(gate, STATS_RATE_LIMIT) },
    )
  }

  try {
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
  } catch (err) {
    captureServerError(err, { route: '/api/stats', userId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
