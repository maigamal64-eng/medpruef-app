import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser, isPaidAccess } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'
import { isMailSuppressed } from '@/lib/mail-suppression'
import { checkoutResumeEnabled, decideCheckoutResume, resumeExcludedIds, RESUME_WINDOW_MS, type ResumeAccount } from '@/lib/checkout-resume'

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

const HIDDEN = { eligible: false }
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * GET /api/checkout-resume: the Home card that takes a learner back to a
 * checkout they opened and never paid (a-checkout-resume). Default off
 * (CHECKOUT_RESUME_ENABLED, read before any database call). Every doubt hides
 * the card: a failed read, an unreadable do-not-contact list or an unknown
 * account answers `{eligible:false}`. The body carries a plan key, a
 * sitting-fit summary and nothing else; never an address, a payment id or a
 * checkout id.
 *
 * Reads run cheapest-first (a-db-relief-1): the learner's recent payment
 * events decide with what the auth guard already knows (role, tier, paid
 * access); only a learner who would see the card costs the users,
 * refund and do-not-contact reads.
 */
export async function GET(req: NextRequest) {
  if (!checkoutResumeEnabled()) return NextResponse.json(HIDDEN, { headers: NO_STORE })
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  try {
    const sb = getServiceClient()
    const excluded = resumeExcludedIds()
    const { data: events, error: evErr } = await sb
      .from('payment_events')
      .select('event, created_at, tier, checkout_session_id, reason')
      .eq('user_id', guard.userId)
      .in('event', ['checkout_session_created', 'checkout_redirected', 'grant_succeeded', 'checkout_failed', 'grant_failed', 'webhook_received'])
      .gte('created_at', new Date(Date.now() - RESUME_WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(200)
    if (evErr) {
      captureServerError(evErr, { route: '/api/checkout-resume', phase: 'events' })
      return NextResponse.json(HIDDEN, { headers: NO_STORE })
    }

    // Step 1: no database read beyond the events. Role and tier come from the guard.
    const base: ResumeAccount = { id: guard.userId, role: guard.role, tier: guard.tier, paidAccess: isPaidAccess(guard), doNotContact: false }
    const early = decideCheckoutResume({ enabled: true, excluded, account: base, events: events ?? [] })
    if (!early.show) return NextResponse.json(HIDDEN, { headers: NO_STORE })

    // Step 2: only now the account row, a refunded/revoked history and the do-not-contact list.
    const { data: user, error: userErr } = await sb
      .from('users').select('id, email, role, tier, exam_date').eq('id', guard.userId).maybeSingle()
    if (userErr || !user) return NextResponse.json(HIDDEN, { headers: NO_STORE })
    const { data: refunded, error: refErr } = await sb
      .from('subscriptions').select('id').eq('user_id', guard.userId).eq('status', 'refunded').limit(1)
    if (refErr) {
      captureServerError(refErr, { route: '/api/checkout-resume', phase: 'refunds' })
      return NextResponse.json(HIDDEN, { headers: NO_STORE })
    }
    // A Telegram-only account has no address, so no list entry can exist for it.
    const email = (user.email as string | null) ?? null
    const doNotContact = email ? await isMailSuppressed(sb, email, 'marketing') : false

    const decision = decideCheckoutResume({
      enabled: true,
      excluded,
      account: {
        ...base,
        role: user.role as string | null,
        tier: user.tier as string | null,
        email,
        examDate: (user.exam_date as string | null) ?? null,
        doNotContact,
        refunded: (refunded ?? []).length > 0,
      },
      events: events ?? [],
    })
    if (!decision.show) return NextResponse.json(HIDDEN, { headers: NO_STORE })
    return NextResponse.json({ eligible: true, tier: decision.tier, fit: decision.fit }, { headers: NO_STORE })
  } catch (err) {
    captureServerError(err, { route: '/api/checkout-resume', userId: guard.userId })
    return NextResponse.json(HIDDEN, { headers: NO_STORE })
  }
}
