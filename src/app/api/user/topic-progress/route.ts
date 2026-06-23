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

    // Get per-topic answer progress, aggregated server-side via the
    // get_user_topic_progress RPC (GROUP BY + count(DISTINCT question_id)
    // in Postgres) rather than SELECTing raw answer_history rows and
    // deduping in JS — the PostgREST client silently caps a SELECT at
    // 1000 rows (the old `.limit(50000)` did not override that ceiling),
    // so the raw-row path gave WRONG per-topic counts for any user with
    // >1000 answers (bug B-21, 2026-06-23; same class as B-07). The RPC
    // reproduces the prior dedup semantics exactly: answered/correct/
    // wrong are each a DISTINCT-question count keyed by question_id, so a
    // question answered both right and wrong counts in both correct and
    // wrong (i.e. wrong is NOT answered - correct), scoped by exam_type,
    // inner-joined to questions with no is_active filter.
    const { data: progressRows } = await sb.rpc('get_user_topic_progress', {
      p_user_id: userId,
      p_exam_type: examType,
    })

    if (!progressRows || !topicCounts) {
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

    const stats: Record<string, { answered: number; correct: number; wrong: number }> = {}
    ;(progressRows as { topic: string; answered: number; correct: number; wrong: number }[]).forEach(r => {
      stats[r.topic] = { answered: r.answered, correct: r.correct, wrong: r.wrong }
    })

    const result = (topicCounts as { topic: string; count: number }[]).map(tc => {
      const s = stats[tc.topic]
      const answered = s ? s.answered : 0
      const correct = s ? s.correct : 0
      const wrong = s ? s.wrong : 0
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
