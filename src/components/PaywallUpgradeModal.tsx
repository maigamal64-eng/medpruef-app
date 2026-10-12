'use client'

/**
 * PaywallUpgradeModal: the one paywall (UX-GLOBAL-19). Opens in place over
 * the current question or page (sheet on phones), focus returns to the
 * trigger on dismiss, never a redirect from a render effect. Copy comes only
 * from paywall-copy.ts (getGateCopy): the server's cap and bank, the learner's
 * own result as positive context, what is kept, then plans first and "Später".
 * A 402 never reveals the next question; the caller keeps its plan-limit
 * state after dismissal.
 */
import Link from 'next/link'
import { Dialog } from '@/components/ui'
import { getGateCopy, getPaywallCopy, type PaywallGateKind } from '@/lib/paywall-copy'
import { trackEvent } from '@/lib/tracker'

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
}

export default function PaywallUpgradeModal({
  open,
  onOpenChange,
  lang = 'de',
  gate = 'qbank_limit',
  bankLabel,
  limit,
  accuracyPct,
  surface = 'quiz',
}: PaywallUpgradeModalProps) {
  const copy = getGateCopy({ lang, gate, bankLabel, limit, accuracyPct })
  const de = lang === 'de'
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
        {copy.result && <p className="text-sm font-semibold text-[var(--mp-fg)]">{copy.result}</p>}
        <p className="text-sm text-[var(--mp-fg)]">{copy.keep}</p>
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {de ? 'Pro enthält den vollen Fragenpool, die Wiederholungsplanung, die Fehlerwiederholung und die Prüfungssimulation.' : 'Pro includes the full bank, review scheduling, mistake review and the mock exam.'}
        </p>
        {gate === 'qbank_limit' && (
          <p className="text-xs text-[var(--mp-fg-subtle)] leading-snug">
            {getPaywallCopy({ lang: de ? 'de' : 'en' }).secondAccountNote}
          </p>
        )}
      </div>
    </Dialog>
  )
}
