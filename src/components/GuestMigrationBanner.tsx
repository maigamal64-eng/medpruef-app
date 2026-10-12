'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getStoredSession } from '@/lib/auth'
import { AlertTriangle, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { t, useLang } from '@/lib/i18n'
import { safeSessionStorage } from "@/lib/safe-storage";

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
  const lang = useLang()

  useEffect(() => {
    const session = getStoredSession()
    const userId = session?.user?.id || ''
    setIsGuest(userId.startsWith('guest_'))
    setDismissed(safeSessionStorage.getItem('medpruef_guest_banner_dismissed') === '1')
  }, [])

  const hideOnPath = ['/login', '/landing', '/privacy', '/terms', '/impressum'].some(p =>
    pathname?.startsWith(p)
  )
  if (!isGuest || dismissed || hideOnPath) return null

  const handleDismiss = () => {
    setDismissed(true)
    safeSessionStorage.setItem('medpruef_guest_banner_dismissed', '1')
  }

  return (
    <div className="bg-gradient-to-r from-[#D68A3A] to-[var(--mp-error)] text-white px-4 py-2.5 shadow-lg">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-xs sm:text-sm font-medium truncate">
            {t('guest_banner_body', lang)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href="/login?mode=register"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-[var(--mp-error)] rounded-lg text-xs font-bold hover:bg-white/90 transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {t('guest_banner_cta', lang)}
          </Link>
          <button
            onClick={handleDismiss}
            className="text-white/70 hover:text-white text-xs px-1.5"
            title={t('guest_banner_dismiss', lang)}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
