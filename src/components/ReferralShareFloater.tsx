'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Gift, X } from 'lucide-react'

/**
 * ReferralShareFloater — corner CTA nudging active users to share their
 * referral link. Soft-launch v1 (2026-04-23).
 *
 * Show rules (all must be true):
 *   - Logged in, non-guest, post-onboarding.
 *   - On the home dashboard (/), the flashcards page, or /quiz (i.e.
 *     active-study surfaces — not legal/settings/auth pages).
 *   - User has completed at least 5 questions in their history
 *     (signal: the dashboard has rendered StatsCard with answered > 5).
 *     We don't block on this — we trust the page's own rendering — we
 *     just wait 6 seconds after mount so we don't greet the user with
 *     a referral nag.
 *   - Not dismissed in the last 7 days (localStorage timestamp).
 *
 * Positioning:
 *   - Bottom-right floating pill, above the FeedbackWidget but below
 *     any active toast. Mobile: full-width bottom-banner (stacked above
 *     BottomNav via z-index + bottom offset).
 *
 * NOTE: this component does NOT fetch the referral code — it links to
 * /referrals where the existing referral page handles code generation,
 * payouts, etc. Keeps this component cheap and decoupled.
 */

const STORAGE_KEY = 'medpruef_referral_floater_dismissed_at'
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const ALLOWED_PATHS = ['/', '/flashcards', '/quiz']
const MOUNT_DELAY_MS = 6000

export default function ReferralShareFloater() {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!pathname) return
    if (!ALLOWED_PATHS.includes(pathname)) return

    try {
      // Gate 1: user logged in + non-guest?
      const raw = localStorage.getItem('medpruef_session')
      if (!raw) return
      const session = JSON.parse(raw || '{}')
      const userId = session?.user?.id || ''
      if (!userId || userId.startsWith('guest_')) return

      // Gate 2: post-onboarding?
      const onboarding = JSON.parse(
        localStorage.getItem('medpruef_onboarding') || '{}'
      )
      if (!onboarding?.completedAt) return

      // Gate 3: cooldown from last dismiss?
      const dismissedAtRaw = localStorage.getItem(STORAGE_KEY)
      if (dismissedAtRaw) {
        const dismissedAt = parseInt(dismissedAtRaw, 10)
        if (
          !isNaN(dismissedAt) &&
          Date.now() - dismissedAt < DISMISS_COOLDOWN_MS
        ) {
          return
        }
      }

      // Delayed reveal — avoid greeting users with a nag.
      const timer = setTimeout(() => setVisible(true), MOUNT_DELAY_MS)
      return () => clearTimeout(timer)
    } catch {
      // silent
    }
  }, [pathname])

  const handleDismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()))
    } catch {}
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Empfehlungsprogramm"
      className="fixed z-[55] bottom-20 right-4 sm:bottom-4 sm:right-4 max-w-sm animate-fade-in"
    >
      <div className="relative rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border)] shadow-xl p-4 pr-10">
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-2 right-2 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] p-1"
          aria-label="Hinweis schließen"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-[var(--mp-r-card)] bg-[var(--mp-cta-blue)]/10 flex items-center justify-center flex-shrink-0">
            <Gift
              className="w-5 h-5 text-[var(--mp-cta-blue)]"
              aria-hidden
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--mp-fg)] leading-snug">
              Empfehle MedPrüf — verdiene €25–75 pro Anmeldung
            </p>
            <p className="text-xs text-[var(--mp-fg-subtle)] mt-1 leading-relaxed">
              Plus €400 Prüfungsgebühren-Rückzahlung, wenn du beim ersten
              Mal bestehst.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Link
                href="/referrals?utm_source=floater&utm_medium=floater&utm_campaign=soft_launch_v1"
                onClick={() => setVisible(false)}
                className="mp-btn mp-btn--primary text-xs px-3 py-1.5"
              >
                Link holen
              </Link>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] px-2 py-1"
              >
                Nicht jetzt
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
