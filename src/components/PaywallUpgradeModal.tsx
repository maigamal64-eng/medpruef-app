'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dialog } from '@/components/ui'
import { Lock, ShieldCheck, Check } from 'lucide-react'
import { getPaywallCopy } from '@/lib/paywall-copy'
import { getStoredSession } from '@/lib/auth'

/**
 * PaywallUpgradeModal — shown when a free-tier user hits the 150-question
 * per-exam cap (API returns `paywallHit: true`) from a context where the
 * inline full-page prompt isn't the right UX (e.g. mid-quiz, post-flashcard-
 * flip, or any CTA triggered from a list view).
 *
 * The flashcards page renders its own full-bleed upgrade screen — we keep
 * this modal orthogonal: callers opt in by wiring the `open` prop. It is
 * NOT auto-shown; the caller is responsible for localStorage throttle if
 * they don't want to nag the same user twice in one session.
 *
 * Copy comes from `src/lib/paywall-copy.ts` — a single source of truth so
 * the flashcards full-bleed upgrade screen and this modal never drift
 * (post-soft-launch §1.4.7). Do NOT hand-roll strings here; update the
 * shared module if a change is needed.
 */

interface PaywallUpgradeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which exam the user hit the cap on — used for copy nuance + utm. */
  examLabel?: string
  /** utm_source override — defaults to 'paywall_modal'. */
  utmSource?: string
  /** German/English copy toggle. Defaults to de (Austrian primary audience). */
  lang?: 'de' | 'en'
}

export default function PaywallUpgradeModal({
  open,
  onOpenChange,
  examLabel,
  utmSource = 'paywall_modal',
  lang = 'de',
}: PaywallUpgradeModalProps) {
  // Pull the user's own labour stats so the milestone intro reflects
  // them at the friction moment (review-2026-04-25-B4 — endowment
  // effect). Reads from the session blob (denormalized values stamped
  // at last login) — no extra fetch needed. If the session is fresh
  // and gam stats haven't propagated, falls back to the generic
  // milestone copy in paywall-copy.
  const [stats, setStats] = useState<
    { answered?: number; accuracyPct?: number; streakDays?: number } | undefined
  >(undefined)
  useEffect(() => {
    if (!open) return
    try {
      const s = getStoredSession()
      const g = s?.gamification
      if (!g) return
      const answered = g.total_questions_answered ?? 0
      const accuracyPct =
        answered > 0 && (g.total_correct ?? 0) >= 0
          ? Math.round(((g.total_correct ?? 0) / answered) * 100)
          : 0
      const streakDays = g.current_streak ?? 0
      setStats({
        answered: answered > 0 ? answered : undefined,
        accuracyPct: accuracyPct > 0 ? accuracyPct : undefined,
        streakDays: streakDays > 0 ? streakDays : undefined,
      })
    } catch {
      /* fall back to generic copy */
    }
  }, [open])
  const copy = getPaywallCopy({ lang, examLabel, stats })
  const pricingHref = `/pricing?utm_source=${encodeURIComponent(
    utmSource
  )}&utm_medium=modal&utm_campaign=paywall_v1${
    examLabel ? `&exam=${encodeURIComponent(examLabel)}` : ''
  }`

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      maxWidth="480px"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <Link
            href={pricingHref}
            onClick={() => onOpenChange(false)}
            className="mp-btn mp-btn--primary mp-btn--lg flex-1 text-center"
          >
            {copy.primaryCta}
          </Link>
          <button
            onClick={() => onOpenChange(false)}
            className="mp-btn mp-btn--secondary mp-btn--lg flex-1"
          >
            {copy.secondaryCta}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)]">
          <Lock
            className="w-5 h-5 text-[var(--mp-cta-blue)] flex-shrink-0 mt-0.5"
            aria-hidden
          />
          <p className="text-sm text-[var(--mp-fg)]">
            {copy.milestoneIntro}{' '}
            <span className="text-[var(--mp-fg-subtle)]">
              {copy.milestoneFollowup}
            </span>
          </p>
        </div>

        <ul className="space-y-2">
          {copy.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Check
                className="w-4 h-4 text-[var(--mp-accent-teal)] flex-shrink-0 mt-0.5"
                aria-hidden
              />
              <span className="text-[var(--mp-fg)]">{b}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 text-xs text-[var(--mp-fg-subtle)] pt-1">
          <ShieldCheck
            className="w-3.5 h-3.5 text-[var(--mp-accent-teal)]"
            aria-hidden
          />
          <span>{copy.reassurance}</span>
        </div>
      </div>
    </Dialog>
  )
}
