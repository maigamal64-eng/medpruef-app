'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Timer, Sparkles } from 'lucide-react'

/**
 * June-26-Pharmakologie-Kohorte countdown banner.
 *
 * Renders a fixed-top strip showing days remaining until the next
 * Pharmakologie exam date (Fri 2026-06-26). Drives urgency for the
 * soft-launch Founders-tier push without being annoying:
 *   - Only shown to logged-in, non-guest users, post-onboarding.
 *   - Hides automatically on /login, /landing, /privacy, /terms,
 *     /impressum, /onboarding, /pricing (the pricing page itself
 *     already communicates the cohort value-prop).
 *   - sessionStorage dismissal — user closes it once, it stays
 *     closed for the tab session.
 *   - Versioned storage key (`_v1`) so we can re-announce if the
 *     cohort anchor changes (e.g. October '26 Kenntnisprüfung cycle).
 *
 * Stacks ABOVE GuestMigrationBanner by using a LOWER z-index (60 vs 70)
 * so if both fire, the guest banner wins — guests can't convert through
 * the cohort CTA anyway, and the account-creation nudge is more urgent.
 */

const COHORT_EXAM_ISO = '2026-06-26T09:00:00+02:00' // Fri morning, Vienna time
const STORAGE_KEY = 'medpruef_cohort_banner_dismissed_v1'
const HIDE_PATHS = [
  '/login',
  '/landing',
  '/privacy',
  '/terms',
  '/impressum',
  '/onboarding',
  '/pricing',
]

function getDaysUntil(targetIso: string): number {
  const now = Date.now()
  const then = new Date(targetIso).getTime()
  const ms = then - now
  if (ms <= 0) return 0
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

export default function CohortCountdownBanner() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [daysLeft, setDaysLeft] = useState<number | null>(null)

  useEffect(() => {
    try {
      // Gate 1: dismissed this session?
      if (sessionStorage.getItem(STORAGE_KEY) === '1') return

      // Gate 2: logged in + non-guest?
      const raw = localStorage.getItem('medpruef_session')
      if (!raw) return
      const session = JSON.parse(raw || '{}')
      const userId = session?.user?.id || ''
      if (!userId || userId.startsWith('guest_')) return

      // Gate 3: post-onboarding only — avoid stacking banners on fresh users
      const onboarding = JSON.parse(
        localStorage.getItem('medpruef_onboarding') || '{}'
      )
      if (!onboarding?.completedAt) return

      const days = getDaysUntil(COHORT_EXAM_ISO)
      if (days <= 0) return // cohort has passed — silent

      setDaysLeft(days)
      setVisible(true)
    } catch {
      // silent
    }
  }, [])

  const hideOnPath = HIDE_PATHS.some((p) => pathname?.startsWith(p))
  if (!visible || daysLeft === null || hideOnPath) return null

  const handleDismiss = () => {
    setVisible(false)
    try {
      sessionStorage.setItem(STORAGE_KEY, '1')
    } catch {}
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-[var(--mp-cta-blue)] to-[var(--mp-accent-teal)] text-white px-4 py-2.5 shadow-lg">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Timer className="w-4 h-4 flex-shrink-0" aria-hidden />
          <p className="text-xs sm:text-sm font-medium truncate">
            <span className="font-bold">Juni-26-Kohorte:</span>{' '}
            {daysLeft === 1
              ? 'Noch 1 Tag bis zur Pharmakologie-Prüfung.'
              : `Noch ${daysLeft} Tage bis zur Pharmakologie-Prüfung.`}{' '}
            <span className="hidden sm:inline">
              Pass first try — or study free until you do.
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/pricing?utm_source=cohort_banner&utm_medium=banner&utm_campaign=pharma_jun26"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[var(--mp-cta-blue)] rounded-lg text-xs font-bold hover:bg-white/90 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            Pläne ansehen
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-white/70 hover:text-white text-xs px-1.5"
            aria-label="Banner schließen"
            title="Dismiss for this session"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
