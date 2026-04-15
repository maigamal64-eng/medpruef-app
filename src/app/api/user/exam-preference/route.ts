import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { EXAM_SOURCE_IDS } from '@/lib/topics'
import { requireUser } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'

/**
 * PATCH — Update the current user's active_exam preference.
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
    const { activeExam } = await req.json()
    if (!activeExam) {
      return NextResponse.json({ error: 'activeExam required' }, { status: 400 })
    }
    if (!(EXAM_SOURCE_IDS as string[]).includes(activeExam)) {
      return NextResponse.json({ error: 'Invalid exam type' }, { status: 400 })
    }

    const sb = getServiceClient()
    const { error } = await sb
      .from('users')
      .update({ active_exam: activeExam })
      .eq('id', userId)

    if (error) {
      console.error('[exam-preference PATCH]', error)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, persisted: true })
  } catch (err) {
    console.error('[exam-preference PATCH]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
