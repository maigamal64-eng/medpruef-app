import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'
import { isMailSuppressed } from '@/lib/mail-suppression'
import { decideRenewalRecovery, recoveryExcludedIds, renewalRecoveryEnabled, RECOVERY_EVENT, RECOVERY_WINDOW_MS } from '@/lib/renewal-recovery'

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

const HIDDEN = { eligible: false }
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * GET /api/renewal-recovery: the Home card that opens the stored Whop recovery
 * link of a declined renewal (a-renewal-recovery-card). Default off
 * (RENEWAL_RECOVERY_CARD_ENABLED, read before any database call). Every doubt
 * hides the card: a failed read or an unreadable do-not-contact list answers
 * `{eligible:false}`. Reads run cheapest-first: the learner's own recovery rows
 * decide before the account, refund and suppression reads. The body carries the
 * learner's own whop.com recovery link and a kind, never an address or an id.
 */
export async function GET(req: NextRequest) {
  if (!renewalRecoveryEnabled()) return NextResponse.json(HIDDEN, { headers: NO_STORE })
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  try {
    const sb = getServiceClient()
    const excluded = recoveryExcludedIds()
    const since = new Date(Date.now() - RECOVERY_WINDOW_MS).toISOString()
    // user_events.user_id is text; the webhook writes the mapped learner id.
    const { data: rows, error: rowErr } = await sb
      .from('user_events')
      .select('created_at, event_data')
      .eq('user_id', guard.userId)
      .eq('event_type', RECOVERY_EVENT)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5)
    if (rowErr) {
      captureServerError(rowErr, { route: '/api/renewal-recovery', phase: 'rows' })
      return NextResponse.json(HIDDEN, { headers: NO_STORE })
    }
    const base = { id: guard.userId, role: guard.role, tier: guard.tier, suppressedAll: false }
    const early = decideRenewalRecovery({ enabled: true, excluded, account: base, rows: rows ?? [], grants: [] })
    if (!early.show) return NextResponse.json(HIDDEN, { headers: NO_STORE })

    // Window-wide, not "since the row": the row's created_at is the insert time of a
    // possibly redelivered webhook, so a grant is matched by payment id as well as by time.
    const { data: grants, error: grantErr } = await sb
      .from('payment_events')
      .select('created_at, payment_id')
      .eq('user_id', guard.userId)
      .eq('event', 'grant_succeeded')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(50)
    if (grantErr) {
      captureServerError(grantErr, { route: '/api/renewal-recovery', phase: 'grants' })
      return NextResponse.json(HIDDEN, { headers: NO_STORE })
    }
    const { data: revokes, error: revokeErr } = await sb
      .from('user_events')
      .select('created_at')
      .eq('user_id', guard.userId)
      .eq('event_type', 'whop_subscription_revoked')
      .gte('created_at', early.at)
      .limit(1)
    if (revokeErr) {
      captureServerError(revokeErr, { route: '/api/renewal-recovery', phase: 'revokes' })
      return NextResponse.json(HIDDEN, { headers: NO_STORE })
    }
    const { data: user, error: userErr } = await sb
      .from('users').select('id, email, role, tier').eq('id', guard.userId).maybeSingle()
    if (userErr || !user) return NextResponse.json(HIDDEN, { headers: NO_STORE })
    const { data: refunded, error: refErr } = await sb
      .from('subscriptions').select('id').eq('user_id', guard.userId).eq('status', 'refunded').limit(1)
    if (refErr) {
      captureServerError(refErr, { route: '/api/renewal-recovery', phase: 'refunds' })
      return NextResponse.json(HIDDEN, { headers: NO_STORE })
    }
    // Transactional category: only a scope `all` row blocks. An unreadable list throws and hides.
    const email = (user.email as string | null) ?? null
    const suppressedAll = email ? await isMailSuppressed(sb, email, 'transactional') : false
    // A Telegram-only account has no address, so no list entry can exist for it.

    const decision = decideRenewalRecovery({
      enabled: true,
      excluded,
      account: { ...base, role: user.role as string | null, tier: user.tier as string | null, email, suppressedAll, refunded: (refunded ?? []).length > 0 },
      rows: rows ?? [],
      grants: grants ?? [],
      revokes: revokes ?? [],
    })
    if (!decision.show) return NextResponse.json(HIDDEN, { headers: NO_STORE })
    return NextResponse.json({ eligible: true, url: decision.url, kind: decision.kind }, { headers: NO_STORE })
  } catch (err) {
    captureServerError(err, { route: '/api/renewal-recovery', userId: guard.userId })
    return NextResponse.json(HIDDEN, { headers: NO_STORE })
  }
}
