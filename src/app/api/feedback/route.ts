import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'

export const dynamic = 'force-dynamic'

/** POST — Submit user feedback with auto-captured context.
 *
 * User identity: prefers the `x-user-id` header (set by authFetch)
 * over body-supplied userId, mirroring /api/suggestions. Anonymous
 * submissions (no valid user id) are still accepted. */
export async function POST(req: NextRequest) {
  try {
    const { message, context, userId: bodyUserId } = await req.json()
    if (!message || typeof message !== 'string' || message.trim().length < 3) {
      return NextResponse.json({ error: 'Message too short' }, { status: 400 })
    }

    const headerId = req.headers.get('x-user-id')
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const candidate =
      headerId && uuidRe.test(headerId)
        ? headerId
        : bodyUserId && uuidRe.test(bodyUserId)
          ? bodyUserId
          : null

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

    if (status !== 'all') {
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
