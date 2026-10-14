import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireUser } from '@/lib/auth-guard'
import {
  buildReferralLink,
  generateReferralCode,
  isValidReferralCodeFormat,
} from '@/lib/referrals'
import { REFERRAL_ANNUAL_CAP_CENTS, TIERS } from '@/lib/nowpayments'
import { REFERRAL_EXAM_REWARD_THRESHOLD } from '@/lib/referral-exam-reward'
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { referralMentorCreditsOffered } from '@/lib/referral-mentor-credits'


export const dynamic = 'force-dynamic'
export const maxDuration = 30;

/**
 * GET /api/referrals/status
 *
 * Referral dashboard payload. Shape is a superset of the pre-Lock-#3
 * response — existing keys (`referralCode`, `referralLink`, `stats`,
 * `referrals`, `payoutMethod`) are preserved so the old frontend
 * doesn't break; new keys (`stats.qualifiedInHold`, `stats.claimable`,
 * `stats.earnedCents`, `stats.annualCapRemainingCents`, `tieredPayouts`)
 * layer on top.
 *
 * Referral states (see supabase migration 20260423200000_referrals_tiering):
 *   - pending                — referee signed up, hasn't paid yet
 *   - qualified, in hold     — referee paid BUT hold_expires_at > now()
 *   - qualified, claimable   — hold_expires_at <= now() AND reward > 0
 *   - rewarded               — admin processed payout
 *
 * Code generation: if users.referral_code IS NULL or malformed, mint a
 * fresh 8-char uppercase alphanumeric and retry on UNIQUE collision.
 */
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req)
  if ('error' in guard) return guard.error
  const userId = guard.userId

  try {
    const sb = getServiceClient()

    // 1) Fetch caller's referral_code + payout config. Regenerate if
    //    missing/malformed.
    const { data: me, error: meErr } = await sb
      .from('users')
      .select(
        'id, referral_code, payout_method, payout_wallet_address, payout_wallet_chain, payout_wise_email'
      )
      .eq('id', userId)
      .maybeSingle()

    if (meErr || !me) {
      console.error('[referrals/status] user lookup', meErr)
      return NextResponse.json(
        { error: 'User lookup failed' },
        { status: 500 }
      )
    }

    // 1b) Fetch referral_code_copied_at from user_announcements. Drives
    //     the amber nudge-dot on the sidebar and the "has the user
    //     earned their first share yet?" copy on /referrals. Nullable
    //     by design — a NULL means "never copied" and the nudge stays
    //     lit. Non-fatal if the lookup fails (dot just defaults to lit).
    let referralCodeCopiedAt: string | null = null
    try {
      const { data: ann } = await sb
        .from('user_announcements')
        .select('referral_code_copied_at')
        .eq('user_id', userId)
        .maybeSingle()
      referralCodeCopiedAt =
        (ann?.referral_code_copied_at as string | null | undefined) ?? null
    } catch {
      // Silently tolerate — the gate still works, the dot just stays lit.
    }

    let code = (me.referral_code || '').toUpperCase()
    if (!code || !isValidReferralCodeFormat(code)) {
      let attempts = 0
      while (attempts < 5) {
        const candidate = generateReferralCode()
        const { error: updErr } = await sb
          .from('users')
          .update({ referral_code: candidate })
          .eq('id', userId)

        if (!updErr) {
          code = candidate
          break
        }
        if ((updErr as { code?: string }).code !== '23505') {
          console.error('[referrals/status] code update', updErr)
          return NextResponse.json(
            { error: 'Failed to generate referral code' },
            { status: 500 }
          )
        }
        attempts++
      }
      if (!code) {
        return NextResponse.json(
          { error: 'Could not generate unique referral code' },
          { status: 500 }
        )
      }
    }

    // 2) Fetch referrals. Only pull the embedded referee.first_name
    //    here — the subscriptions tier lookup is a separate query
    //    below since the FK on subscriptions points at users.id, not
    //    referrals.referee_user_id (Supabase PostgREST can't auto-join
    //    that shape).
    const { data: rawRefs, error: refErr } = await sb
      .from('referrals')
      .select(
        `id, status, qualified_at, rewarded_at, created_at, reward_credit_cents,
         referral_code, hold_expires_at, hold_reason, referee_user_id, reward_type,
         referee:referee_user_id ( first_name )`
      )
      .eq('referrer_user_id', userId)
      .order('created_at', { ascending: false })

    if (refErr) {
      console.error('[referrals/status] referrals lookup', refErr)
      return NextResponse.json(
        { error: 'Referrals lookup failed' },
        { status: 500 }
      )
    }

    type RawRefRow = {
      id: string
      status: 'pending' | 'qualified' | 'rewarded'
      qualified_at: string | null
      rewarded_at: string | null
      created_at: string
      reward_credit_cents: number | null
      referral_code: string | null
      hold_expires_at: string | null
      hold_reason: string | null
      referee_user_id: string | null
      reward_type: 'cash' | 'pro_until_exam' | null
      referee:
        | { first_name: string | null }
        | Array<{ first_name: string | null }>
        | null
    }

    const refs: RawRefRow[] = (rawRefs as RawRefRow[]) || []

    // 2b) Pull the most-relevant subscription tier for each referee
    //     (active preferred, else newest). Batched in one query by
    //     user_id IN (...) rather than N round-trips.
    const refereeIds = Array.from(
      new Set(
        refs
          .map((r) => r.referee_user_id)
          .filter((v): v is string => !!v)
      )
    )

    const tierByReferee = new Map<string, string | null>()
    if (refereeIds.length > 0) {
      const { data: subs, error: subsErr } = await sb
        .from('subscriptions')
        .select('user_id, tier, status, started_at')
        .in('user_id', refereeIds)
        .order('started_at', { ascending: false })

      if (subsErr) {
        console.error('[referrals/status] subs lookup', subsErr)
        // non-fatal — rows just won't have a plan name
      } else {
        type SubRow = {
          user_id: string
          tier: string | null
          status: string | null
          started_at: string | null
        }
        // First pass: take the newest active sub per user.
        for (const s of (subs || []) as SubRow[]) {
          if (!s.user_id) continue
          if (s.status === 'active' && !tierByReferee.has(s.user_id)) {
            tierByReferee.set(s.user_id, s.tier ?? null)
          }
        }
        // Second pass: for users with no active sub, fall back to the
        // newest any-status sub.
        for (const s of (subs || []) as SubRow[]) {
          if (!s.user_id) continue
          if (!tierByReferee.has(s.user_id)) {
            tierByReferee.set(s.user_id, s.tier ?? null)
          }
        }
      }
    }

    const nowMs = Date.now()

    // ── Derived per-row flags ─────────────────────────────────────
    const rowInHold = (r: RawRefRow) =>
      r.status === 'qualified' &&
      !!r.hold_expires_at &&
      new Date(r.hold_expires_at).getTime() > nowMs
    const rowClaimable = (r: RawRefRow) =>
      r.status === 'qualified' &&
      (!r.hold_expires_at || new Date(r.hold_expires_at).getTime() <= nowMs) &&
      (r.reward_credit_cents ?? 0) > 0

    // ── Stats ─────────────────────────────────────────────────────
    const totalReferrals = refs.length
    const pending = refs.filter((r) => r.status === 'pending').length
    const qualifiedInHold = refs.filter(rowInHold).length
    const claimable = refs.filter(rowClaimable).length
    const rewarded = refs.filter((r) => r.status === 'rewarded').length

    const earnedCents = refs
      .filter((r) => r.status === 'qualified' || r.status === 'rewarded')
      .reduce((acc, r) => acc + (r.reward_credit_cents ?? 0), 0)
    const paidOutCents = refs
      .filter((r) => r.status === 'rewarded')
      .reduce((acc, r) => acc + (r.reward_credit_cents ?? 0), 0)

    // Annual-cap remaining (current calendar year, based on qualified_at).
    const nowDate = new Date()
    const yearStart = new Date(
      Date.UTC(nowDate.getUTCFullYear(), 0, 1)
    ).toISOString()
    const yearSumCents = refs
      .filter(
        (r) =>
          (r.status === 'qualified' || r.status === 'rewarded') &&
          r.qualified_at &&
          r.qualified_at >= yearStart
      )
      .reduce((acc, r) => acc + (r.reward_credit_cents ?? 0), 0)
    const annualCapRemainingCents = Math.max(
      0,
      REFERRAL_ANNUAL_CAP_CENTS - yearSumCents
    )

    // Privacy-masked first initial: "M." or null if unavailable.
    function firstInitial(r: RawRefRow): string | null {
      const rel = r.referee
      const name = Array.isArray(rel)
        ? rel[0]?.first_name
        : rel?.first_name || null
      if (!name) return null
      const trimmed = name.trim()
      if (!trimmed) return null
      return `${trimmed.charAt(0).toUpperCase()}.`
    }

    // Human-readable plan the referee is on. Uses the TIERS.humanName
    // from src/lib/nowpayments.ts when the tier id is known.
    function planHumanName(r: RawRefRow): string | null {
      if (!r.referee_user_id) return null
      const tier = tierByReferee.get(r.referee_user_id)
      if (!tier) return null
      const def = TIERS[tier]
      return def?.humanName ?? tier
    }

    const referrals = refs.map((r) => ({
      id: r.id,
      status: r.status,
      reward_credit_cents: r.reward_credit_cents ?? 0,
      reward_type: r.reward_type ?? 'cash',
      referral_code: r.referral_code,
      qualified_at: r.qualified_at,
      hold_expires_at: r.hold_expires_at,
      rewarded_at: r.rewarded_at,
      created_at: r.created_at,
      hold_reason: r.hold_reason,
      in_hold: rowInHold(r),
      claimable: rowClaimable(r),
      referee_first_initial: firstInitial(r),
      referee_plan_humanname: planHumanName(r),
      // ── Legacy keys preserved for old UI ──
      createdAt: r.created_at,
      qualifiedAt: r.qualified_at,
      rewardedAt: r.rewarded_at,
      rewardCreditCents: r.reward_credit_cents ?? 0,
      refereeFirstName: firstInitial(r) ?? '—',
    }))

    // Tiered payout reference table — drives the small table on the
    // referral page. Mirrors src/lib/nowpayments.ts TIERS[*].referralPayoutCents.
    // Retained for legacy rows / any surface not yet migrated off it; the
    // rewritten /referrals page (2026-07-11) no longer reads this.
    const tieredPayouts: Array<{ plan: string; payoutEuros: number }> = [
      { plan: 'monthly', payoutEuros: 25 },
      { plan: '3 months', payoutEuros: 25 },
      { plan: '6 months', payoutEuros: 50 },
      { plan: '12 months', payoutEuros: 50 },
      { plan: 'Exam Cohort', payoutEuros: 75 },
    ]

    // ── Referral exam-reward (2026-07-11) — this referrer's progress
    // toward the N=2 threshold + when their grant landed, if any.
    const proUntilExamRows = refs.filter((r) => r.reward_type === 'pro_until_exam')
    const qualifiedActivityCount = proUntilExamRows.filter(
      (r) => r.status === 'qualified' || r.status === 'rewarded'
    ).length
    const proUntilExamGrantedAt =
      proUntilExamRows.find((r) => r.status === 'rewarded')?.rewarded_at ?? null

    // a-mentor-open: present (a number) only while REFERRAL_MENTOR_CREDITS_ENABLED is on.
    const mentorCredits = referralMentorCreditsOffered()
    return NextResponse.json({
      referralCode: code,
      referralLink: buildReferralLink(code),
      ...(mentorCredits ? { mentorCredits } : {}),
      stats: {
        // ── New shape (Lock #3) ──
        totalReferrals,
        pending,
        qualifiedInHold,
        claimable,
        rewarded,
        earnedCents,
        paidOutCents,
        annualCapCents: REFERRAL_ANNUAL_CAP_CENTS,
        annualCapRemainingCents,
        // ── Legacy keys preserved for old UI ──
        totalReferred: totalReferrals,
        qualifiedCount: qualifiedInHold + claimable + rewarded,
        pendingCount: pending,
        creditCents: earnedCents,
        creditEuros: Math.floor(earnedCents / 100),
        maxCreditCents: REFERRAL_ANNUAL_CAP_CENTS,
        maxCreditEuros: Math.floor(REFERRAL_ANNUAL_CAP_CENTS / 100),
        remainingToMaxCents: annualCapRemainingCents,
        remainingToMaxEuros: Math.floor(annualCapRemainingCents / 100),
        rewardPerReferralCents: 2500,
        rewardPerReferralEuros: 25,
      },
      tieredPayouts,
      // ── Referral exam-reward (2026-07-11) ──
      qualifiedActivityCount,
      thresholdN: REFERRAL_EXAM_REWARD_THRESHOLD,
      proUntilExamGrantedAt,
      referrals,
      payoutMethod: (me.payout_method as
        | 'crypto_wallet'
        | 'wise_account'
        | null) || null,
      payoutWalletAddress: me.payout_wallet_address || null,
      payoutWalletChain: me.payout_wallet_chain || null,
      payoutWiseEmail: me.payout_wise_email || null,
      // rescue-sprint §4: NULL → "never copied", lights the sidebar
      // nudge-dot and gates the post-quiz share prompt.
      referralCodeCopiedAt,
    })
  } catch (err) {
    console.error('[referrals/status]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const GET = withDbUnavailable(handleGET);
