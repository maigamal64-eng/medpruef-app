'use client'

import Link from 'next/link'
import { Dialog } from '@/components/ui'
import { Lock, ShieldCheck, Check } from 'lucide-react'

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
 * Copy is tuned for the soft-launch positioning:
 *   - Leads with PUYP ("pass first try — or study free until you do").
 *   - Frames the cap as "150 free done" rather than "blocked".
 *   - Single primary CTA → /pricing with utm tagging.
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
  const de = lang === 'de'
  const pricingHref = `/pricing?utm_source=${encodeURIComponent(
    utmSource
  )}&utm_medium=modal&utm_campaign=paywall_v1${
    examLabel ? `&exam=${encodeURIComponent(examLabel)}` : ''
  }`

  const title = de
    ? 'Freie 150 Fragen geschafft — weiter mit Pro'
    : 'Free 150 done — continue with Pro'

  const description = de
    ? 'Hol dir Zugriff auf den kompletten Fragenpool (10.993 Fragen) plus Wiederholungsplan, Mock-Prüfung und die Pass-Garantie.'
    : 'Unlock the full 10,993-question bank, spaced repetition, mock exam, and the pass-or-study-free guarantee.'

  const bullets: string[] = de
    ? [
        'Voller Zugriff auf alle 10.993 Fragen über alle 3 Prüfungstypen',
        'Pass first try — oder lerne kostenlos weiter bis zum Bestehen',
        'Wiederholungsplan, Mock-Prüfung und Leistungs-Dashboard',
        '7-Tage-Geld-zurück-Garantie — keine Fragen',
      ]
    : [
        'Full access to all 10,993 questions across 3 exam types',
        'Pass first try — or study free until you do',
        'Spaced repetition, mock exam, and performance dashboard',
        '7-day money-back guarantee — no questions asked',
      ]

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      maxWidth="480px"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <Link
            href={pricingHref}
            onClick={() => onOpenChange(false)}
            className="mp-btn mp-btn--primary mp-btn--lg flex-1 text-center"
          >
            {de ? 'Pläne ansehen' : 'See plans'}
          </Link>
          <button
            onClick={() => onOpenChange(false)}
            className="mp-btn mp-btn--secondary mp-btn--lg flex-1"
          >
            {de ? 'Später' : 'Later'}
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
            {de
              ? 'Du hast die 150 kostenlosen Fragen für diese Prüfung durchgearbeitet.'
              : 'You finished the 150 free questions for this exam.'}{' '}
            <span className="text-[var(--mp-fg-subtle)]">
              {de
                ? 'Das ist ein Meilenstein — jetzt kommt der wichtige Teil.'
                : "That's a milestone — now comes the meaningful part."}
            </span>
          </p>
        </div>

        <ul className="space-y-2">
          {bullets.map((b, i) => (
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
          <span>
            {de
              ? 'Keine automatische Verlängerung ohne Ankündigung. Kündigung mit 1-Klick.'
              : 'No silent auto-renewal. Cancel with one click.'}
          </span>
        </div>
      </div>
    </Dialog>
  )
}
