import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { isPaidAccess, requireUser } from '@/lib/auth-guard'
import { getTopicCountsCached, loadFreeAccess, loadFreeSetLive } from '@/lib/free-tier'
import { freeLeftByTopic } from '@/lib/free-set'
import { topicMetrics } from '@/lib/learning-metrics'
import { shareInFlight } from '@/lib/inflight'
import { withDbUnavailable } from "@/lib/db-unavailable-route";

/** The a12 newest-attempt read is optional until 20261221090000 is applied. */
function missingFunction(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === 'PGRST202' || error.code === '42883'))
}

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

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
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  try {
    const sp = req.nextUrl.searchParams
    const examType = sp.get('examType') || 'kenntnispruefung'

    const sb = getServiceClient()

    // a-free-set: free learners see how many free questions are left per
    // topic (free set minus their answers). Paid callers get nothing extra.
    // A failed read leaves the fields out rather than showing a wrong 0.
    const withFreeCounts = async <T extends { topic: string }>(rows: T[]): Promise<Array<T & { freeTotal?: number; freeLeft?: number }>> => {
      try {
        if (isPaidAccess(guard)) return rows
        const [access, topicOf] = await Promise.all([
          loadFreeAccess(sb, userId, examType, { strict: true }),
          loadFreeSetLive(sb, examType),
        ])
        const left = freeLeftByTopic(topicOf, access.answered)
        const total = new Map<string, number>()
        for (const topic of topicOf.values()) total.set(topic, (total.get(topic) ?? 0) + 1)
        return rows.map((row) => ({
          ...row,
          freeTotal: total.get(row.topic) ?? 0,
          freeLeft: access.capped ? 0 : (left.get(row.topic) ?? 0),
        }))
      } catch (err) {
        console.error('[topic-progress free counts]', err)
        return rows
      }
    }

    // a-stability (2026-10-12): concurrent requests for the same learner and
    // bank (Home, the mentor Heute card, curriculum, a tab-return refresh)
    // share one round of the three learner aggregates instead of each
    // running all three. Nothing is cached after the round settles.
    const [countsResult, progressResult, attemptsResult, lastResult] = await shareInFlight(
      `topic-progress:${userId}:${examType}`,
      () => Promise.all([
        // Bank-wide counts change only when questions are (de)activated:
        // 1 h per-instance cache (2026-10-10, W2-DB1).
        getTopicCountsCached(sb, examType),
        sb.rpc('get_user_topic_progress', { p_user_id: userId, p_exam_type: examType }),
        sb.rpc('get_user_topic_attempt_stats', { p_user_id: userId, p_exam_type: examType }),
        sb.rpc('get_user_topic_last_correct', { p_user_id: userId, p_exam_type: examType }),
      ]),
    )
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
        // UX-HOME-25: open mistakes = distinct questions whose newest attempt was wrong (null before the a12 read exists).
        openMistakes: last ? Math.max(0, last.answered - last.lastCorrect) : null,
        accuracy: attempts && attempts.attempts > 0
          ? Math.round((attempts.correctAttempts / attempts.attempts) * 100)
          : 0,
      }
    })

    return NextResponse.json(await withFreeCounts(result))
  } catch (err) {
    console.error('[topic-progress GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const GET = withDbUnavailable(handleGET);
