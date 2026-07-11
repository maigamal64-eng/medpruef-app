import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser, isPaidAccess } from '@/lib/auth-guard'
import { captureServerError } from '@/lib/sentry-capture'

export const dynamic = 'force-dynamic'

/**
 * GET /api/checkout-feedback/eligibility — checkout-stall feedback prompt.
 *
 * Targets the two warm stalled buyers who reached Whop checkout and never
 * completed (the #1 open business question: why do buyers freeze at card
 * entry). Eligible only when ALL of:
 *
 *   (a) kill switch — CHECKOUT_FEEDBACK_ENABLED !== 'false' (default ON;
 *       this is a low-risk feedback surface, no separate default-OFF flag).
 *   (b) a `payment_events` row `event='checkout_redirected'` for this user
 *       within the last 21 days.
 *   (c) NO `grant_succeeded` for them after that checkout_redirected — they
 *       actually stalled, didn't just pay later.
 *   (d) no existing `user_feedback` row with `context->>'type' = 'checkout_stall'`
 *       for this user — asked once, ever (cross-device, since it's server-side).
 *   (e) the caller does not already have paid access (`isPaidAccess`) — an
 *       admin or already-Pro account isn't "stalled," it already has access.
 *       Without this an admin who once test-clicked checkout (tier='pro',
 *       role='admin') would still show as eligible under (b)-(d) alone.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error

  try {
    if (process.env.CHECKOUT_FEEDBACK_ENABLED === 'false') {
      return NextResponse.json({ eligible: false })
    }

    if (isPaidAccess(guard)) {
      return NextResponse.json({ eligible: false })
    }

    const sb = getServiceClient()
    const cutoffIso = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString()

    // (b) + (c): most recent checkout_redirected within 21 days, then check
    // whether a grant_succeeded landed after it.
    const { data: redirects, error: redirectsErr } = await sb
      .from('payment_events')
      .select('created_at')
      .eq('user_id', guard.userId)
      .eq('event', 'checkout_redirected')
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(1)

    if (redirectsErr) {
      captureServerError(redirectsErr, { route: '/api/checkout-feedback/eligibility', phase: 'redirects' })
      return NextResponse.json({ eligible: false })
    }

    const lastRedirectAt = redirects?.[0]?.created_at as string | undefined
    if (!lastRedirectAt) {
      return NextResponse.json({ eligible: false })
    }

    const { data: grants, error: grantsErr } = await sb
      .from('payment_events')
      .select('id')
      .eq('user_id', guard.userId)
      .eq('event', 'grant_succeeded')
      .gt('created_at', lastRedirectAt)
      .limit(1)

    if (grantsErr) {
      captureServerError(grantsErr, { route: '/api/checkout-feedback/eligibility', phase: 'grants' })
      return NextResponse.json({ eligible: false })
    }

    if (grants && grants.length > 0) {
      return NextResponse.json({ eligible: false })
    }

    // (d): asked once, ever.
    const { data: existingFeedback, error: feedbackErr } = await sb
      .from('user_feedback')
      .select('id')
      .eq('user_id', guard.userId)
      .eq('context->>type', 'checkout_stall')
      .limit(1)

    if (feedbackErr) {
      captureServerError(feedbackErr, { route: '/api/checkout-feedback/eligibility', phase: 'existing_feedback' })
      return NextResponse.json({ eligible: false })
    }

    if (existingFeedback && existingFeedback.length > 0) {
      return NextResponse.json({ eligible: false })
    }

    return NextResponse.json({ eligible: true })
  } catch (err) {
    captureServerError(err, { route: '/api/checkout-feedback/eligibility', userId: guard.userId })
    return NextResponse.json({ eligible: false })
  }
}
