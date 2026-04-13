import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/** POST — Submit user feedback with auto-captured context */
export async function POST(req: NextRequest) {
  try {
    const { message, context, userId } = await req.json()
    if (!message || typeof message !== 'string' || message.trim().length < 3) {
      return NextResponse.json({ error: 'Message too short' }, { status: 400 })
    }

    const sb = getServiceClient()
    const { error } = await sb.from('user_feedback').insert({
      user_id: userId && !userId.startsWith('guest_') ? userId : null,
      message: message.trim(),
      context: context || {},
      status: 'new',
    })

    if (error) {
      console.error('[feedback POST]', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[feedback POST]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/** GET — Admin: list feedback (newest first) */
export async function GET(req: NextRequest) {
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
    console.error('[feedback GET]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
