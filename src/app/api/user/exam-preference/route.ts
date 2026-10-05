import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { EXAM_SOURCE_IDS } from '@/lib/topics'
import { requireUser } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

/** GET — read the authenticated account's canonical exam selection. */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const { data, error } = await getServiceClient()
    .from('users')
    .select('active_exam, exam_date')
    .eq('id', guard.userId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Failed to load exam preference' }, { status: 500 })
  const activeExam = typeof data?.active_exam === 'string' && (EXAM_SOURCE_IDS as string[]).includes(data.active_exam)
    ? data.active_exam
    : 'kenntnispruefung'
  const examDate = typeof data?.exam_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.exam_date)
    ? data.exam_date
    : null
  return NextResponse.json({ activeExam, examDate })
}

/**
 * PATCH — Update the current user's active_exam preference and/or
 * exam_date / daily_goal. All three fields are optional; the handler
 * only updates whatever the body provides.
 *
 * Body shape:
 *   {
 *     activeExam?: 'kenntnispruefung'|'kmp_innsbruck'|'pharma',
 *     examDate?:   string (YYYY-MM-DD) | null,
 *     dailyGoal?:  number (5..200)
 *   }
 *
 * Auth: requireUser — userId derived from the session header. The
 * previous version accepted `userId` in the body, which meant any
 * stranger could flip any user's exam preference (BE-P1-012).
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  try {
    const body = await req.json()
    const { activeExam, examDate, dailyGoal } = body as {
      activeExam?: string
      examDate?: string | null
      dailyGoal?: number
    }

    // Must have at least one field to update
    if (
      activeExam === undefined &&
      examDate === undefined &&
      dailyGoal === undefined
    ) {
      return NextResponse.json(
        { error: 'at least one of activeExam, examDate, dailyGoal required' },
        { status: 400 }
      )
    }

    const update: Record<string, unknown> = {}

    if (activeExam !== undefined) {
      if (!(EXAM_SOURCE_IDS as string[]).includes(activeExam)) {
        return NextResponse.json({ error: 'Invalid exam type' }, { status: 400 })
      }
      update.active_exam = activeExam
    }

    if (examDate !== undefined) {
      if (examDate === null || examDate === '') {
        update.exam_date = null
      } else if (typeof examDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
        // Reject invalid calendar dates like 2026-02-30
        const parsed = new Date(examDate + 'T00:00:00Z')
        if (isNaN(parsed.getTime())) {
          return NextResponse.json({ error: 'Invalid exam date' }, { status: 400 })
        }
        update.exam_date = examDate
      } else {
        return NextResponse.json(
          { error: 'examDate must be YYYY-MM-DD or null' },
          { status: 400 }
        )
      }
    }

    if (dailyGoal !== undefined) {
      if (typeof dailyGoal !== 'number' || !Number.isFinite(dailyGoal)) {
        return NextResponse.json(
          { error: 'dailyGoal must be a number' },
          { status: 400 }
        )
      }
      const clamped = Math.max(5, Math.min(200, Math.round(dailyGoal)))
      update.daily_goal = clamped
    }

    const sb = getServiceClient()
    const { error } = await sb.from('users').update(update).eq('id', userId)

    if (error) {
      console.error('[exam-preference PATCH]', error)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, persisted: true, updated: update })
  } catch (err) {
    console.error('[exam-preference PATCH]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
