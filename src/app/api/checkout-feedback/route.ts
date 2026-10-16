import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'
import { recordEventSafe } from '@/lib/user-events'
import { sanitizeEventData } from '@/lib/analytics-events'
import { checkoutReturnReadEnabled } from '@/lib/checkout-return-read'
import { hasEventSince, returnDecisionFor } from '@/lib/checkout-return-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

const REASONS = ['card_not_accepted', 'page_error', 'changed_mind', 'price', 'other'] as const
type Reason = (typeof REASONS)[number]

function isReason(v: unknown): v is Reason {
  return typeof v === 'string' && (REASONS as readonly string[]).includes(v)
}

const REASON_LABELS: Record<Reason, string> = {
  card_not_accepted: 'card_not_accepted',
  page_error: 'page_error',
  changed_mind: 'changed_mind',
  price: 'price',
  other: 'other',
}

/**
 * POST /api/checkout-feedback — one-tap checkout-stall answer.
 *
 * `requireUser`-guarded (not anonymous — unlike the general /api/feedback,
 * this surface only ever renders for an eligible signed-in user, and the
 * eligibility check + the tier lookup below both need a real userId).
 *
 * Body: { reason: 'card_not_accepted'|'page_error'|'changed_mind'|'price'|'other',
 *         details?: string (<=500 chars) }
 *
 * Inserts into `user_feedback` (the existing admin inbox + review crons
 * already read this table — no new surface needed):
 *   - message: readable "[checkout-stall] <reason>" line + details if any
 *   - context: { type: 'checkout_stall', reason, tier, url }
 *   - status: 'new'
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error

  try {
    const body = await req.json().catch(() => null)
    const reason = body?.reason
    const detailsRaw = body?.details
    const urlRaw = body?.url

    if (!isReason(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
    }

    let details: string | null = null
    if (detailsRaw !== undefined && detailsRaw !== null) {
      if (typeof detailsRaw !== 'string') {
        return NextResponse.json({ error: 'Invalid details' }, { status: 400 })
      }
      details = detailsRaw.trim().slice(0, 500) || null
    }

    // Sanitize the caller-provided page path: keep it a same-origin path
    // only (no protocol/host, no query/hash) so we never persist an
    // attacker-controlled absolute URL.
    let url: string | null = null
    if (typeof urlRaw === 'string' && urlRaw.startsWith('/')) {
      url = urlRaw.split('?')[0].split('#')[0].slice(0, 200)
    }

    const sb = getServiceClient()

    // Most recent checkout_redirected tier for this user, looked up
    // server-side (never trust a client-supplied tier).
    const { data: lastRedirect } = await sb
      .from('payment_events')
      .select('tier')
      .eq('user_id', guard.userId)
      .eq('event', 'checkout_redirected')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const message = `[checkout-stall] ${REASON_LABELS[reason]}${details ? `: ${details}` : ''}`

    const { error } = await sb.from('user_feedback').insert({
      user_id: guard.userId,
      message,
      context: {
        type: 'checkout_stall',
        reason,
        tier: lastRedirect?.tier ?? null,
        url,
      },
      status: 'new',
    })

    if (error) {
      captureServerError(error, { route: '/api/checkout-feedback', method: 'POST', phase: 'insert', userId: guard.userId })
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    // a-checkout-return-read: one answered row for the Monday read (reason is the fixed enum, never the details text).
    // Gated like the shown row: same exclusions, a redirect in the return window, once per redirect.
    if (checkoutReturnReadEnabled()) {
      const read = await returnDecisionFor(sb, guard, '/api/checkout-feedback')
      if (!read.error && read.decision.show) {
        const seen = await hasEventSince(sb, guard.userId, 'checkout_stall_answered', read.decision.redirectedAt, '/api/checkout-feedback')
        if (seen === false) {
          await recordEventSafe(sb, {
            userId: guard.userId,
            eventType: 'checkout_stall_answered',
            data: sanitizeEventData('checkout_stall_answered', { reason, tier: read.decision.tier, surface: 'pricing' }),
          })
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    captureServerError(err, { route: '/api/checkout-feedback', method: 'POST', userId: guard.userId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
