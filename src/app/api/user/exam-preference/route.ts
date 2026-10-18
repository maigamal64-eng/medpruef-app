import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { EXAM_SOURCE_IDS } from '@/lib/topics'
import { requireUser } from '@/lib/auth-guard'
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { saveExamPreference, type ExamPreferenceUpdate } from "@/lib/exam-preference-write";
import { SITTING_SET_EVENT, activeSittingSetSources, sittingSetEventData } from '@/lib/tg-welcome/sitting-event'
import { afterResponse } from '@/lib/after-response'
import { captureServerError } from '@/lib/sentry-capture'
import { scheduleIntercomContactSync } from "@/lib/intercom/sync";

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

/** GET — read the authenticated account's canonical exam selection. */
async function handleGET(req: NextRequest) {
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
 *     dailyGoal?:  number (5..200),
 *     source?:     'tg_welcome' (a-tg-miniapp-welcome: a saved date also
 *                  stores one sitting_set user_event; unknown sources are ignored)
 *   }
 *
 * Auth: requireUser — userId derived from the session header. The
 * previous version accepted `userId` in the body, which meant any
 * stranger could flip any user's exam preference (BE-P1-012).
 */
/** One sitting_set user_event for a date saved by a known picker source. Never throws. */
async function recordSittingSet(sb: ReturnType<typeof getServiceClient>, userId: string, source: string, bankInBody: string | null, examDate: string): Promise<void> {
  try {
    let bank = bankInBody
    if (!bank) {
      const { data: row } = await sb.from('users').select('active_exam').eq('id', userId).maybeSingle()
      bank = typeof row?.active_exam === 'string' ? row.active_exam : null
    }
    const event = sittingSetEventData({ source, activeExam: bank, examDate, now: new Date() })
    if (!event) return
    const { error } = await sb.from('user_events').insert({ user_id: userId, event_type: SITTING_SET_EVENT, event_data: event })
    if (error) captureServerError(error, { route: 'user/exam-preference', phase: 'sitting_set' })
  } catch (failure) {
    captureServerError(failure, { route: 'user/exam-preference', phase: 'sitting_set' })
  }
}

async function handlePATCH(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  try {
    const body = await req.json()
    const { activeExam, examDate, dailyGoal, source } = body as {
      activeExam?: string
      examDate?: string | null
      dailyGoal?: number
      source?: unknown
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

    const update: ExamPreferenceUpdate = {}

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
    const { error } = await saveExamPreference(sb, userId, update)

    if (error) {
      console.error('[exam-preference PATCH]', error)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    // a-tg-miniapp-welcome: the picker's source records one sitting_set row,
    // after the response (the date is saved either way; a slow database never
    // turns a saved date into a "save failed" on the learner's screen).
    const examDateSaved = update.exam_date
    if (typeof examDateSaved === 'string' && typeof source === 'string' && activeSittingSetSources().includes(source)) {
      const bankInBody = typeof update.active_exam === 'string' ? update.active_exam : null
      await afterResponse('exam-preference sitting_set', () => recordSittingSet(sb, userId, source, bankInBody, examDateSaved))
    }
    if ('active_exam' in update || 'exam_date' in update) scheduleIntercomContactSync(userId, 'exam_set')

    return NextResponse.json({ ok: true, persisted: true, updated: update })
  } catch (err) {
    console.error('[exam-preference PATCH]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const GET = withDbUnavailable(handleGET);
export const PATCH = withDbUnavailable(handlePATCH);
