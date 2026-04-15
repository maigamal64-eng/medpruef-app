'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getStoredSession } from '@/lib/auth'
import { AlertTriangle, UserPlus } from 'lucide-react'
import Link from 'next/link'

/**
 * Persistent banner shown to users logged in as guest_*.
 * Encourages them to create an account to preserve progress.
 * Hidden on /login, /landing, /privacy, /terms pages.
 *
 * 2026-04-15: switched from `window.location.pathname`-on-mount to
 * `usePathname()` from next/navigation so the hide/show decision
 * reacts to App Router soft navigations (Frontend audit P1-8).
 * Also stopped setting `isGuest=false` as a "hide" mechanism —
 * isGuest now tracks the real session state honestly.
 */
export default function GuestMigrationBanner() {
  const [isGuest, setIsGuest] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const session = getStoredSession()
    const userId = session?.user?.id || ''
    setIsGuest(userId.startsWith('guest_'))
    setDismissed(sessionStorage.getItem('medpruef_guest_banner_dismissed') === '1')
  }, [])

  const hideOnPath = ['/login', '/landing', '/privacy', '/terms', '/impressum'].some(p =>
    pathname?.startsWith(p)
  )
  if (!isGuest || dismissed || hideOnPath) return null

  const handleDismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('medpruef_guest_banner_dismissed', '1')
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[70] bg-gradient-to-r from-[#F4A261] to-[#D64545] text-white px-4 py-2.5 shadow-lg">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs sm:text-sm font-medium truncate">
            You&apos;re in guest mode — your progress won&apos;t sync across devices.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/login?mode=register"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[#D64545] rounded-lg text-xs font-bold hover:bg-white/90 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Create Account
          </Link>
          <button
            onClick={handleDismiss}
            className="text-white/70 hover:text-white text-xs px-1.5"
            title="Dismiss for this session"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
