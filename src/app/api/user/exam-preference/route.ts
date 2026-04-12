import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { EXAM_SOURCE_IDS } from '@/lib/topics'

export const dynamic = 'force-dynamic'

/**
 * PATCH — Update the user's active_exam preference.
 * Body: { userId: string, activeExam: ExamSourceId }
 * Only logged-in users (not guests) can persist this.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId, activeExam } = await req.json()
    if (!userId || !activeExam) {
      return NextResponse.json({ error: 'userId and activeExam required' }, { status: 400 })
    }
    if (userId.startsWith('guest_')) {
      // Guest sessions don't have a DB row; preference is localStorage-only
      return NextResponse.json({ ok: true, persisted: false })
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
