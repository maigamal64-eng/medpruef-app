import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'
import {
  isValidWalletAddress,
  isValidWiseEmail,
  PAYOUT_WALLET_CHAINS,
  type PayoutMethod,
  type PayoutWalletChain,
} from '@/lib/referrals'

export const dynamic = 'force-dynamic'
export const maxDuration = 30;

/**
 * PATCH /api/referrals/payout-method
 *
 * The user chooses HOW they want to receive their referral rebate.
 *
 * Body (discriminated union on `method`):
 *   { method: 'crypto_wallet',
 *     walletAddress: string,
 *     walletChain: 'TRC20' | 'ERC20' | 'POLYGON' }
 *
 *   { method: 'wise_account',
 *     wiseEmail: string }
 *
 *   { method: null }  // clear the method
 *
 * Validation is intentionally loose (regex-only, no checksumming) —
 * real-world verification happens at payout execution time.
 *
 * TODO: admin-UI for executing payouts. v1 is manual — [name] reads the
 * admin referrals tab, sends the USDT tx / Wise transfer, and marks
 * the row rewarded. Automated payout is a post-launch enhancement.
 */
export async function PATCH(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  try {
    const body = await req.json().catch(() => ({}))
    const method = (body?.method ?? null) as PayoutMethod | null

    // Null = clear the payout method entirely.
    if (method === null) {
      const sb = getServiceClient()
      const { error } = await sb
        .from('users')
        .update({
          payout_method: null,
          payout_wallet_address: null,
          payout_wallet_chain: null,
          payout_wise_email: null,
        })
        .eq('id', userId)

      if (error) {
        console.error('[referrals/payout-method PATCH] clear', error)
        return NextResponse.json(
          { error: 'Failed to clear payout method' },
          { status: 500 }
        )
      }
      return NextResponse.json({ ok: true, cleared: true })
    }

    if (method !== 'crypto_wallet' && method !== 'wise_account') {
      return NextResponse.json(
        { error: 'Invalid method' },
        { status: 400 }
      )
    }

    const update: Record<string, string | null> = {
      payout_method: method,
      // Reset the other branch's columns so we never leak stale state
      // across method switches (e.g. switch wallet → wise, the old
      // wallet address must NOT remain in the row).
      payout_wallet_address: null,
      payout_wallet_chain: null,
      payout_wise_email: null,
    }

    if (method === 'crypto_wallet') {
      const address =
        typeof body?.walletAddress === 'string'
          ? body.walletAddress.trim()
          : ''
      const chainRaw =
        typeof body?.walletChain === 'string'
          ? body.walletChain.toUpperCase()
          : ''

      if (!PAYOUT_WALLET_CHAINS.includes(chainRaw as PayoutWalletChain)) {
        return NextResponse.json(
          { error: 'Invalid wallet chain. Must be TRC20, ERC20, or POLYGON.' },
          { status: 400 }
        )
      }
      const chain = chainRaw as PayoutWalletChain

      if (!isValidWalletAddress(address, chain)) {
        return NextResponse.json(
          {
            error:
              chain === 'TRC20'
                ? 'Invalid TRC20 address. Must start with T and be 34 base58 characters.'
                : 'Invalid EVM address. Must start with 0x followed by 40 hex characters.',
          },
          { status: 400 }
        )
      }

      update.payout_wallet_address = address
      update.payout_wallet_chain = chain
    }

    if (method === 'wise_account') {
      const email =
        typeof body?.wiseEmail === 'string' ? body.wiseEmail.trim() : ''
      if (!isValidWiseEmail(email)) {
        return NextResponse.json(
          { error: 'Invalid Wise email address.' },
          { status: 400 }
        )
      }
      update.payout_wise_email = email.toLowerCase()
    }

    const sb = getServiceClient()
    const { error } = await sb.from('users').update(update).eq('id', userId)

    if (error) {
      console.error('[referrals/payout-method PATCH] update', error)
      return NextResponse.json(
        { error: 'Failed to save payout method' },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, method })
  } catch (err) {
    console.error('[referrals/payout-method PATCH]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
