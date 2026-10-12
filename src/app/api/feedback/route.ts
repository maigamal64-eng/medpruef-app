import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireAdmin, resolveOptionalUser } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'
import { logAdminAction, resolveActorEmail } from '@/lib/admin/audit'
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from '@/lib/admin/permissions'
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
export const maxDuration = 30;

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
 * accepted, but are throttled per IP; signed-in callers are
 * throttled per user. Bodies over 8 KB are rejected with 413. */
export async function POST(req: NextRequest) {
  try {
    // Identity comes ONLY from the verified session token (S-1) — never
    // the header or a body-supplied userId, both client-controlled.
    // Signed-in callers are throttled per user (so colleagues behind one
    // hospital NAT do not share a budget); anonymous callers per IP.
    const candidate = resolveOptionalUser(req)
    if (candidate) {
      const userGate = checkRateLimit({ key: rateKey('feedback-user', candidate), ...FEEDBACK_USER_LIMIT })
      if (!userGate.allowed) return tooMany(userGate, FEEDBACK_USER_LIMIT)
    } else {
      const ipGate = checkRateLimit({ key: rateKey('feedback-ip', callerIp(req)), ...FEEDBACK_IP_LIMIT })
      if (!ipGate.allowed) return tooMany(ipGate, FEEDBACK_IP_LIMIT)
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
      // a15: the first-reply stamp is admin-owned; never accepted from the learner.
      context: Object.fromEntries(Object.entries((context || {}) as Record<string, unknown>).filter(([key]) => key !== 'first_replied_at' && key !== 'first_replied_by')),
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

const FEEDBACK_STATUSES = new Set(['new', 'reviewed', 'resolved', 'dismissed'])
const NOTE_MAX = 2000

/** PATCH — Admin: update feedback status + note, or record the first reply.
 *  a15 (UX-ADM-15, pick-support-measure A): needs feedback.manage; the note
 *  is saved with the status change; `replied: true` stamps
 *  context.first_replied_at once (the first-reply time the support metric
 *  reads) and is audited as feedback_replied. */
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req)
  if ('error' in guard) return guard.error
  try {
    if (!canAccessAdminPermission(await loadAdminPermissionSnapshot(guard.userId), 'feedback.manage')) {
      return NextResponse.json({ error: 'Your admin role cannot change feedback.' }, { status: 403 })
    }
    const body = await req.json().catch(() => null)
    const { id, status, admin_note, replied } = (body && typeof body === 'object' ? body : {}) as { id?: unknown; status?: unknown; admin_note?: unknown; replied?: unknown }
    if (!id || (!status && replied !== true)) {
      return NextResponse.json({ error: 'id and status required' }, { status: 400 })
    }
    if (status !== undefined && (typeof status !== 'string' || !FEEDBACK_STATUSES.has(status))) {
      return NextResponse.json({ error: 'status must be new, reviewed, resolved or dismissed' }, { status: 400 })
    }
    if (admin_note !== undefined && admin_note !== null && (typeof admin_note !== 'string' || admin_note.length > NOTE_MAX)) {
      return NextResponse.json({ error: `admin_note must be text up to ${NOTE_MAX} characters` }, { status: 400 })
    }
    const sb = getServiceClient()
    const actorEmail = await resolveActorEmail(guard.userId)
    const targetId = typeof id === 'number' ? id : String(id)

    if (replied === true) {
      const { data: row, error: readError } = await sb.from('user_feedback').select('id, context').eq('id', id).maybeSingle()
      if (readError) return NextResponse.json({ error: 'Could not read this feedback' }, { status: 500 })
      if (!row) return NextResponse.json({ error: 'Feedback not found' }, { status: 404 })
      const context = (row.context && typeof row.context === 'object' ? row.context : {}) as Record<string, unknown>
      if (typeof context.first_replied_at !== 'string') {
        const at = new Date().toISOString()
        const { data: stamped, error: stampError } = await sb.from('user_feedback')
          .update({ context: { ...context, first_replied_at: at, first_replied_by: guard.userId } })
          .eq('id', id)
          .is('context->>first_replied_at', null)
          .select('id')
          .maybeSingle()
        if (stampError) return NextResponse.json({ error: 'Could not record the reply' }, { status: 500 })
        if (stamped) await logAdminAction({ req, actorId: guard.userId, actorEmail, action: 'feedback_replied', targetType: 'user_feedback', targetId, payload: { first_replied_at: at } })
      }
      if (!status) return NextResponse.json({ ok: true })
    }

    const update: Record<string, unknown> = { status }
    if (admin_note !== undefined) update.admin_note = typeof admin_note === 'string' && admin_note.trim() ? admin_note.trim() : null
    const { error } = await sb.from('user_feedback').update(update).eq('id', id)
    if (error) return NextResponse.json({ error: 'Could not update this feedback' }, { status: 500 })

    await logAdminAction({
      req,
      actorId: guard.userId,
      actorEmail,
      action: 'update_feedback_status',
      targetType: 'user_feedback',
      // user_feedback.id is bigserial, not UUID. Helper will stash it in payload.target_ref.
      targetId,
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

/** GET — Admin: list feedback (newest first).
 *  a15: needs feedback.read. With users.read each row carries `sender`
 *  (name, email, Telegram username) for Copy contact and the profile link;
 *  without it, no learner identity is read. `?summary=1` returns the median
 *  first-reply time over the last 30 days instead of rows. */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if ('error' in guard) return guard.error
  try {
    const permissions = await loadAdminPermissionSnapshot(guard.userId)
    if (!canAccessAdminPermission(permissions, 'feedback.read')) {
      return NextResponse.json({ error: 'Your admin role cannot read feedback.' }, { status: 403 })
    }
    const sp = req.nextUrl.searchParams
    const sb = getServiceClient()

    if (sp.get('summary') === '1') {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const { data, error } = await sb.from('user_feedback').select('created_at, context').gte('created_at', since).limit(2000)
      if (error) return NextResponse.json({ error: 'Could not read feedback' }, { status: 500 })
      const rows = (data ?? []) as Array<{ created_at: string; context: Record<string, unknown> | null }>
      const hours = rows
        .map((r) => (typeof r.context?.first_replied_at === 'string' ? (Date.parse(r.context.first_replied_at as string) - Date.parse(r.created_at)) / 3_600_000 : NaN))
        .filter((h) => Number.isFinite(h) && h >= 0)
        .sort((a, b) => a - b)
      const mid = Math.floor(hours.length / 2)
      const median = hours.length ? (hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2) : null
      return NextResponse.json({ first_reply: { median_hours: median === null ? null : Math.round(median * 10) / 10, replied: hours.length, received: rows.length, window_days: 30, basis: 'Replies recorded with Mark replied in admin; email-only replies are not counted.' } })
    }

    const status = sp.get('status') || 'new'
    const limit = Math.min(parseInt(sp.get('limit') || '50'), 200)

    let query = sb
      .from('user_feedback')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (status === 'needs_action') {
      query = query.in('status', ['new', 'reviewed'])
    } else if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (data || []) as Array<Record<string, unknown>>
    const senders = new Map<string, { id: string; name: string | null; email: string | null; telegram_username: string | null }>()
    if (canAccessAdminPermission(permissions, 'users.read')) {
      const ids = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => typeof v === 'string'))]
      if (ids.length) {
        const { data: users, error: usersError } = await sb.from('users').select('id, first_name, last_name, email, telegram_username').in('id', ids)
        if (usersError) return NextResponse.json({ error: 'Could not read senders' }, { status: 500 })
        for (const u of (users ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null; telegram_username: string | null }>) {
          senders.set(u.id, { id: u.id, name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null, email: u.email, telegram_username: u.telegram_username })
        }
      }
    }
    // UX-ADM-34: the body stays a list; the matching total rides in a header
    // so the inbox can say "Showing 100 of 240" instead of cutting silently.
    return NextResponse.json(rows.map((r) => ({
      ...r,
      first_replied_at: typeof (r.context as Record<string, unknown> | null)?.first_replied_at === 'string' ? (r.context as Record<string, unknown>).first_replied_at : null,
      sender: typeof r.user_id === 'string' ? senders.get(r.user_id) ?? null : null,
    })), { headers: typeof count === 'number' ? { 'X-Total-Count': String(count) } : {} })
  } catch (err) {
    captureServerError(err, { route: '/api/feedback', method: 'GET', userId: guard.userId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
