import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { claimReferralCode } from '@/lib/referral-claim'
import { requireUser } from '@/lib/auth-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

/**
 * POST /api/referrals/claim
 *
 * Called from the landing / login / register flow after a successful
 * signup when the URL carried `?ref=<code>`. The client stores the
 * code in localStorage (`medpruef_ref_code`) while the user completes
 * signup, then POSTs here once the session is available.
 *
 * Body: { referralCode: string }
 *
 * Behavior:
 *   - 400 if the code is missing / wrong shape
 *   - 404 if the code doesn't match any users.referral_code
 *   - 409 if this user is already attributed (users.referred_by_code set)
 *   - 409 if the user tries to self-refer
 *   - 200 + {referrer: {firstName}} on success, with
 *     users.referred_by_code set AND a pending referrals row inserted
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  try {
    const body = await req.json().catch(() => ({}))
    const raw = typeof body?.referralCode === 'string' ? body.referralCode : ''
    // The claim itself lives in src/lib/referral-claim.ts (shared with the typed-code front door).
    const r = await claimReferralCode(getServiceClient(), userId, raw)
    switch (r.status) {
      case 'invalid': return NextResponse.json({ error: 'Invalid referral code format' }, { status: 400 })
      case 'not_found': return NextResponse.json({ error: 'Referral code not found' }, { status: 404 })
      case 'already': return NextResponse.json({ error: 'Referral already claimed' }, { status: 409 })
      case 'self': return NextResponse.json({ error: 'Cannot refer yourself' }, { status: 409 })
      case 'deduped': return NextResponse.json({ ok: true, deduped: true, referrer: { firstName: r.firstName ?? null } })
      case 'ok': return NextResponse.json({ ok: true, referrer: { firstName: r.firstName ?? null } })
      default: return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
  } catch (err) {
    console.error('[referrals/claim]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
