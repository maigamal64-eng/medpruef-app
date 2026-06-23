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

    // Get per-topic stats. Aggregated server-side via the
    // get_user_topic_stats RPC (GROUP BY in Postgres) rather than
    // SELECTing raw answer_history rows — the PostgREST client silently
    // caps a SELECT at 1000 rows, so the old raw-row + JS-loop path gave
    // WRONG per-topic counts for any user with >1000 answers (bug B-07,
    // 2026-06-23). The RPC reproduces the prior counting semantics
    // exactly: every answer row counted (not deduped by question), topic
    // null/'' bucketed as 'Unknown'.
    const { data: topicRows } = await sb.rpc('get_user_topic_stats', {
      p_user_id: userId,
    })

    const topicStats: Record<string, { total: number; correct: number }> = {}
    ;(topicRows as { topic: string; total: number; correct: number }[] | null)?.forEach((r) => {
      topicStats[r.topic] = { total: r.total, correct: r.correct }
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
