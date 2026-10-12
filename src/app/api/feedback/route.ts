import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireAdmin, resolveOptionalUser } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'
import { logAdminAction, resolveActorEmail } from '@/lib/admin/audit'
import {
  FEEDBACK_IP_LIMIT,
  FEEDBACK_MAX_BODY_BYTES,
  FEEDBACK_MAX_CONTEXT_CHARS,
  FEEDBACK_MAX_CONTEXT_KEYS,
  FEEDBACK_MAX_MESSAGE_CHARS,
  FEEDBACK_USER_LIMIT,
} from '@/lib/feedback-limits'
import { callerIp, checkRateLimit, rateKey, rateLimitHeaders, type RateLimitResult } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function tooMany(gate: RateLimitResult, opts: { limit: number }) {
  return NextResponse.json(
    { error: 'Too many requests', retryAfter: gate.retryAfterSec },
    { status: 429, headers: rateLimitHeaders(gate, opts) },
  )
}

/** Reads the body as text, stopping as soon as it exceeds `maxBytes`.
 *  Returns null when the cap is exceeded. */
async function readBodyCapped(req: NextRequest, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { buf.set(c, offset); offset += c.byteLength }
  return new TextDecoder().decode(buf)
}

/** POST — Submit user feedback with auto-captured context.
 *
 * User identity: derived ONLY from the verified session token (S-1,
 * via resolveOptionalUser) — never a client-supplied header or
 * body userId. Anonymous submissions (no valid session) are still
 * accepted, but are throttled per IP; signed-in callers are also
 * throttled per user. Bodies over 8 KB are rejected with 413. */
export async function POST(req: NextRequest) {
  try {
    const ipGate = checkRateLimit({ key: rateKey('feedback-ip', callerIp(req)), ...FEEDBACK_IP_LIMIT })
    if (!ipGate.allowed) return tooMany(ipGate, FEEDBACK_IP_LIMIT)

    // Identity comes ONLY from the verified session token (S-1) — never
    // the header or a body-supplied userId, both client-controlled.
    const candidate = resolveOptionalUser(req)
    if (candidate) {
      const userGate = checkRateLimit({ key: rateKey('feedback-user', candidate), ...FEEDBACK_USER_LIMIT })
      if (!userGate.allowed) return tooMany(userGate, FEEDBACK_USER_LIMIT)
    }

    const raw = await readBodyCapped(req, FEEDBACK_MAX_BODY_BYTES)
    if (raw === null) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const { message, context } = body as { message?: unknown; context?: unknown }
    if (!message || typeof message !== 'string' || message.trim().length < 3) {
      return NextResponse.json({ error: 'Message too short' }, { status: 400 })
    }
    if (message.trim().length > FEEDBACK_MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 })
    }
    if (context !== undefined && context !== null) {
      if (typeof context !== 'object' || Array.isArray(context)) {
        return NextResponse.json({ error: 'Invalid context' }, { status: 400 })
      }
      if (
        Object.keys(context).length > FEEDBACK_MAX_CONTEXT_KEYS ||
        JSON.stringify(context).length > FEEDBACK_MAX_CONTEXT_CHARS
      ) {
        return NextResponse.json({ error: 'Context too large' }, { status: 400 })
      }
    }

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
