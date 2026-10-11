import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireAdmin, resolveOptionalUser } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'
import { logAdminAction, resolveActorEmail } from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'

/** POST — Submit user feedback with auto-captured context.
 *
 * User identity: derived ONLY from the verified session token (S-1,
 * via resolveOptionalUser) — never a client-supplied header or
 * body userId. Anonymous submissions (no valid session) are still
 * accepted. */
export async function POST(req: NextRequest) {
  try {
    const { message, context } = await req.json()
    if (!message || typeof message !== 'string' || message.trim().length < 3) {
      return NextResponse.json({ error: 'Message too short' }, { status: 400 })
    }

    // Identity comes ONLY from the verified session token (S-1) — never
    // the header or a body-supplied userId, both client-controlled.
    const candidate = resolveOptionalUser(req)

    const sb = getServiceClient()
    let userId: string | null = null
    if (candidate) {
      const { data } = await sb.from('users').select('id').eq('id', candidate).maybeSingle()
      if (data) userId = candidate
    }

    const { error } = await sb.from('user_feedback').insert({
      user_id: userId,
      message: message.trim(),
      context: context || {},
      status: 'new',
    })

    if (error) {
      captureServerError(error, { route: '/api/feedback', method: 'POST', phase: 'insert' })
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    captureServerError(err, { route: '/api/feedback', method: 'POST' })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/** PATCH — Admin: update feedback status + add note */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if ('error' in guard) return guard.error
  try {
    const { id, status, admin_note } = await req.json()
    if (!id || !status) {
      return NextResponse.json({ error: 'id and status required' }, { status: 400 })
    }
    const sb = getServiceClient()
    const update: Record<string, unknown> = { status }
    if (admin_note !== undefined) update.admin_note = admin_note
    const { error } = await sb.from('user_feedback').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const actorEmail = await resolveActorEmail(guard.userId)
    await logAdminAction({
      req,
      actorId: guard.userId,
      actorEmail,
      action: 'update_feedback_status',
      targetType: 'user_feedback',
      // user_feedback.id is bigserial, not UUID. Helper will stash it in payload.target_ref.
      targetId: typeof id === 'number' ? id : String(id),
      payload: {
        new_status: status,
        admin_note: admin_note ?? null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    captureServerError(err, { route: '/api/feedback', method: 'PATCH', userId: guard.userId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/** GET — Admin: list feedback (newest first) */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if ('error' in guard) return guard.error
  try {
    const sp = req.nextUrl.searchParams
    const status = sp.get('status') || 'new'
    const limit = Math.min(parseInt(sp.get('limit') || '50'), 200)

    const sb = getServiceClient()
    let query = sb
      .from('user_feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status === 'needs_action') {
      query = query.in('status', ['new', 'reviewed'])
    } else if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data || [])
  } catch (err) {
    captureServerError(err, { route: '/api/feedback', method: 'GET', userId: guard.userId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
