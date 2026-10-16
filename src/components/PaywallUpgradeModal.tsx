'use client'

/**
 * PaywallUpgradeModal: the one paywall (UX-GLOBAL-19, UX-ACC-24 option B).
 * Opens in place over the current question or page (sheet on phones), focus
 * returns to the trigger on dismiss, never a redirect from a render effect.
 * Copy comes only from paywall-copy.ts (getGateCopy): the server's cap and
 * bank, the learner's own result as positive context, what is kept, the
 * renewal truth, then plans first, the card trial as a clearly labelled
 * secondary (only when the account can still take it) and "Später". At the
 * bank cap the other banks are offered in place ("Andere Prüfung üben").
 * A 402 never reveals the next question; the caller keeps its plan-limit
 * state after dismissal.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dialog } from '@/components/ui'
import { getGateCopy, type PaywallGateKind } from '@/lib/paywall-copy'
import { billingAmount } from '@/lib/billing-copy'
import { authFetch } from '@/lib/authFetch'
import { getStoredSession } from '@/lib/auth'
import { trackEvent } from '@/lib/tracker'
import TrialEndCard from '@/components/trial-end/TrialEndCard'
import { useTrialEnd } from '@/components/trial-end/useTrialEnd'

interface PaywallUpgradeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  lang?: string
  gate?: PaywallGateKind
  /** Bank label (getExamLabel) for the qbank title. */
  bankLabel?: string
  limit?: number
  accuracyPct?: number | null
  /** Where the learner came from, for paywall_click attribution. */
  surface?: string
  /** Other banks offered at the bank cap; picking one switches in place. */
  otherExams?: Array<{ id: string; label: string }>
  onSwitchExam?: (id: string) => void
}

type TrialTerms = { days: number; priceAfterCents: number }

export default function PaywallUpgradeModal({
  open,
  onOpenChange,
  lang = 'de',
  gate = 'qbank_limit',
  bankLabel,
  limit,
  accuracyPct,
  surface = 'quiz',
  otherExams,
  onSwitchExam,
}: PaywallUpgradeModalProps) {
  const copy = getGateCopy({ lang, gate, bankLabel, limit, accuracyPct })
  const money: 'de' | 'en' = lang === 'en' ? 'en' : 'de'
  const [trial, setTrial] = useState<TrialTerms | null>(null)
  // a-trial-end-decision (TRIAL_END_CARD_ENABLED): after the reverse trial, the gate
  // leads with the learner's saved progress, sitting and the plan that covers it.
  const trialEnd = useTrialEnd('paywall', open)

  // The trial is offered only to an account that can still take it.
  useEffect(() => {
    if (!open || !getStoredSession()?.user.id) return
    let active = true
    authFetch('/api/whop/trial', { timeoutMs: 8_000, skipAuthRedirect: true })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!active) return
        setTrial(d?.eligible === true && Number.isInteger(d.trial_days) && Number.isInteger(d.price_after_cents)
          ? { days: d.trial_days, priceAfterCents: d.price_after_cents } : null)
      })
      .catch(() => { if (active) setTrial(null) })
    return () => { active = false }
  }, [open])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      placement="auto"
      kind="content"
      maxWidth="480px"
      footer={
        <div className="flex flex-col sm:flex-row-reverse gap-2 w-full">
          <Link
            href={copy.pricingHref}
            onClick={() => { trackEvent('paywall_click', { target: 'pricing', gate }); onOpenChange(false) }}
            className="mp-btn mp-btn--primary mp-btn--lg flex-1 justify-center min-h-12"
          >
            {copy.primary}
          </Link>
          <button
            type="button"
            onClick={() => { trackEvent('paywall_click', { target: 'later', gate }); onOpenChange(false) }}
            className="mp-btn mp-btn--secondary mp-btn--lg flex-1 justify-center min-h-12"
          >
            {copy.later}
          </button>
        </div>
      }
    >
      <div className="space-y-3" data-surface={surface}>
        {trialEnd && <TrialEndCard surface="paywall" data={trialEnd} lang={lang} />}
        {copy.result && <p className="text-sm font-semibold text-[var(--mp-fg)]">{copy.result}</p>}
        <p className="text-sm text-[var(--mp-fg)]">{copy.keep}</p>
        {copy.fits && <p className="text-sm text-[var(--mp-fg-muted)]">{copy.fits}</p>}
        <p className="text-sm text-[var(--mp-fg-muted)]">{copy.renewal}</p>
        {trial && (
          <div className="rounded-lg border border-[var(--mp-border-subtle)] p-3">
            <p className="text-sm text-[var(--mp-fg-muted)] m-0">{copy.trialTerms(trial.days, billingAmount(trial.priceAfterCents, money))}</p>
            <Link
              href={copy.trialHref}
              onClick={() => { trackEvent('paywall_click', { target: 'trial', gate }); onOpenChange(false) }}
              className="inline-flex min-h-11 items-center text-sm font-semibold underline"
            >
              {copy.trialLabel}
            </Link>
          </div>
        )}
        {gate === 'qbank_limit' && otherExams && otherExams.length > 0 && onSwitchExam && (
          <div>
            <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">{copy.switchExam}</p>
            <div className="flex flex-wrap gap-2">
              {otherExams.map(exam => (
                <button
                  key={exam.id}
                  type="button"
                  className="mp-btn mp-btn--secondary min-h-11"
                  onClick={() => { trackEvent('paywall_click', { target: 'switch_exam', gate }); onOpenChange(false); onSwitchExam(exam.id) }}
                >
                  {exam.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {gate === 'qbank_limit' && (
          <p className="text-xs text-[var(--mp-fg-subtle)] leading-snug">
            {copy.alreadyPro}{' '}
            <Link href="/login?mode=login&reason=signin_required&next=%2Fquiz" className="underline">{copy.otherAccount}</Link>
          </p>
        )}
      </div>
    </Dialog>
  )
}
