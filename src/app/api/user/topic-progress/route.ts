import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'
import { getTopicCountsCached } from '@/lib/free-tier'
import { topicMetrics } from '@/lib/learning-metrics'

/** The a12 newest-attempt read is optional until 20261204090000 is applied. */
function missingFunction(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === 'PGRST202' || error.code === '42883'))
}

export const dynamic = 'force-dynamic'

/**
 * GET /api/user/topic-progress?examType=...
 *
 * Returns per-topic progress for the authenticated user:
 *   { topic, total, answered, correct, wrong, accuracy,
 *     coveragePct, lastCorrectSample, lastCorrectPct, status }
 *
 * UX-GLOBAL-06: coverage ("gesehen"), "zuletzt richtig" and the topic status
 * are computed here once (src/lib/learning-metrics.ts); pages never recompute
 * them. lastCorrect* are null until the a12 RPC exists.
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

    const [countsResult, progressResult, attemptsResult, lastResult] = await Promise.all([
      // Bank-wide counts change only when questions are (de)activated:
      // 1 h per-instance cache (2026-10-10, W2-DB1).
      getTopicCountsCached(sb, examType),
      sb.rpc('get_user_topic_progress', { p_user_id: userId, p_exam_type: examType }),
      sb.rpc('get_user_topic_attempt_stats', { p_user_id: userId, p_exam_type: examType }),
      sb.rpc('get_user_topic_last_correct', { p_user_id: userId, p_exam_type: examType }),
    ])
    if (lastResult.error && !missingFunction(lastResult.error)) {
      console.error('[topic-progress RPC last-correct]', lastResult.error)
      return NextResponse.json({ error: 'Could not load topic progress' }, { status: 503 })
    }
    const lastByTopic: Record<string, { answered: number; lastCorrect: number }> | null = lastResult.error
      ? null
      : Object.fromEntries(((lastResult.data ?? []) as { topic: string; answered: number; last_correct: number }[])
          .map((r) => [r.topic, { answered: Number(r.answered), lastCorrect: Number(r.last_correct) }]))
    const topicCounts = countsResult.data
    const progressRows = progressResult.data
    const attemptRows = attemptsResult.data
    const queryError = countsResult.error || progressResult.error || attemptsResult.error
    if (queryError) {
      console.error('[topic-progress RPC]', queryError)
      return NextResponse.json({ error: 'Could not load topic progress' }, { status: 503 })
    }

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
    if (!progressRows || !topicCounts || !attemptRows) {
      return NextResponse.json(
        (topicCounts || []).map((t: { topic: string; count: number }) => ({
          ...topicMetrics({ topic: t.topic, total: Number(t.count), answered: 0, lastCorrect: lastByTopic ? 0 : null, lastSample: lastByTopic ? 0 : null }),
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

    const attemptsByTopic: Record<string, { attempts: number; correctAttempts: number }> = {}
    ;(attemptRows as { topic: string; attempts: number; correct_attempts: number }[] | null)?.forEach((r) => {
      attemptsByTopic[r.topic] = { attempts: r.attempts, correctAttempts: r.correct_attempts }
    })

    const result = (topicCounts as { topic: string; count: number }[]).map(tc => {
      const s = stats[tc.topic]
      const answered = s ? s.answered : 0
      const correct = s ? s.correct : 0
      const wrong = s ? s.wrong : 0
      const attempts = attemptsByTopic[tc.topic]
      const last = lastByTopic ? (lastByTopic[tc.topic] ?? { answered: 0, lastCorrect: 0 }) : null
      return {
        ...topicMetrics({ topic: tc.topic, total: Number(tc.count), answered, lastCorrect: last?.lastCorrect ?? null, lastSample: last?.answered ?? null }),
        topic: tc.topic,
        total: Number(tc.count),
        answered,
        correct,
        wrong,
        attempts: attempts?.attempts || 0,
        accuracy: attempts && attempts.attempts > 0
          ? Math.round((attempts.correctAttempts / attempts.attempts) * 100)
          : 0,
      }
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[topic-progress GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
