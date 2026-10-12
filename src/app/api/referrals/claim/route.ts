import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'
import {
  isValidReferralCodeFormat,
  normalizeReferralCode,
} from '@/lib/referrals'
import { isReferralExamRewardEnabled } from '@/lib/referral-exam-reward'

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
    const code = normalizeReferralCode(raw)

    if (!code || !isValidReferralCodeFormat(code)) {
      return NextResponse.json(
        { error: 'Invalid referral code format' },
        { status: 400 }
      )
    }

    const sb = getServiceClient()

    // 1) Did this user already claim a referral?
    const { data: me, error: meErr } = await sb
      .from('users')
      .select('id, referral_code, referred_by_code')
      .eq('id', userId)
      .maybeSingle()

    if (meErr) {
      console.error('[referrals/claim] self lookup', meErr)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    if (!me) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (me.referred_by_code) {
      return NextResponse.json(
        { error: 'Referral already claimed' },
        { status: 409 }
      )
    }

    // 2) Self-referral guard — happens when someone shares their own
    //    link and clicks it back themselves.
    if (me.referral_code && me.referral_code.toUpperCase() === code) {
      return NextResponse.json(
        { error: 'Cannot refer yourself' },
        { status: 409 }
      )
    }

    // 3) Find the referrer. We uppercase the stored code for the match
    //    because legacy codes from the baseline schema default
    //    (substr(md5(...), 1, 8)) may contain lowercase hex digits.
    const { data: referrer, error: refErr } = await sb
      .from('users')
      .select('id, first_name')
      .ilike('referral_code', code)
      .maybeSingle()

    if (refErr) {
      console.error('[referrals/claim] referrer lookup', refErr)
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    if (!referrer) {
      return NextResponse.json(
        { error: 'Referral code not found' },
        { status: 404 }
      )
    }
    if (referrer.id === userId) {
      return NextResponse.json(
        { error: 'Cannot refer yourself' },
        { status: 409 }
      )
    }

    // 4) Mark the user as referred. referred_by_code is the source of
    //    truth; the uuid column users.referred_by is left alone (legacy).
    const { error: updErr } = await sb
      .from('users')
      .update({ referred_by_code: code })
      .eq('id', userId)

    if (updErr) {
      console.error('[referrals/claim] user update', updErr)
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    // 5) Insert the referral row in pending state.
    //
    // reward_type (2026-07-11, race fix): when the exam-reward program
    // is the active mechanic, stamp reward_type='pro_until_exam' on
    // INSERT rather than leaving the 'cash' column default. Without
    // this, a pending row created under the active program was
    // indistinguishable from a legacy cash row, so the legacy webhook
    // qualifier (qualifyReferralOnWhopPayment, still wired for the
    // paused cash program) could win a race against the new activity-
    // based qualifier and flip the row to a cash 'qualified' state on
    // first payment, silently bypassing the card+activity gate
    // entirely. Rows created under the active program ARE program
    // rows. If the exam-reward program is off, the row keeps the
    // 'cash' default (the only mechanic that's actually live then).
    //
    // Qualification: pro_until_exam rows flip via
    // qualifyReferralOnActivity (src/lib/referral-exam-reward.ts,
    // card + activity gated); legacy 'cash' rows still flip in the
    // NOWPayments/Whop webhooks when the referee pays (now additionally
    // scoped to reward_type='cash' as defense-in-depth, see that
    // route). reward_credit_cents stays 0 for pending rows either way.
    const { error: insErr } = await sb.from('referrals').insert({
      referrer_user_id: referrer.id,
      referee_user_id: userId,
      referral_code: code,
      status: 'pending',
      reward_credit_cents: 0,
      reward_type: isReferralExamRewardEnabled() ? 'pro_until_exam' : 'cash',
    })

    if (insErr) {
      // Duplicate — e.g. the user hit /claim twice in a race. The
      // referred_by_code update already succeeded, so downgrade to a
      // soft 200 rather than blowing up.
      if ((insErr as { code?: string }).code === '23505') {
        return NextResponse.json({
          ok: true,
          deduped: true,
          referrer: { firstName: referrer.first_name || null },
        })
      }
      console.error('[referrals/claim] insert', insErr)
      return NextResponse.json(
        { error: 'Failed to create referral' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      referrer: { firstName: referrer.first_name || null },
    })
  } catch (err) {
    console.error('[referrals/claim]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
