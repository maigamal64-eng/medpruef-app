'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getStoredSession } from '@/lib/auth'
import { Info, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { t, useLang } from '@/lib/i18n'
import { safeStorage } from '@/lib/safe-storage'
import { IconButton } from '@/components/ui/IconButton'

const DISMISS_KEY = 'medpruef_guest_banner_hidden_until'
const SEVEN_DAYS = 7 * 86_400_000

/**
 * Legacy guest sessions only (UX-ONB-41). The copy says what the code does:
 * a guest's progress lives on this device, and no carry-over to a new account
 * is promised. Info tone on tokens (no white on amber), wrapping text at 14 px,
 * a 44 px labelled dismiss that hides it for 7 days. /login treats a guest
 * session as signed out, so "Konto erstellen" no longer bounces.
 */
export default function GuestMigrationBanner() {
  const [isGuest, setIsGuest] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const pathname = usePathname()
  const lang = useLang()

  useEffect(() => {
    const userId = getStoredSession()?.user?.id || ''
    setIsGuest(userId.startsWith('guest_'))
    const until = Number(safeStorage.getItem(DISMISS_KEY) || 0)
    setDismissed(Number.isFinite(until) && until > Date.now())
  }, [])

  const hideOnPath = ['/login', '/landing', '/privacy', '/terms', '/impressum'].some(p => pathname?.startsWith(p))
  if (!isGuest || dismissed || hideOnPath) return null

  const handleDismiss = () => {
    setDismissed(true)
    safeStorage.setItem(DISMISS_KEY, String(Date.now() + SEVEN_DAYS))
  }

  return (
    <section
      aria-label={t('a22_guest_cta', lang)}
      className="border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-4 py-2"
    >
      <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <Info className="w-4 h-4 flex-shrink-0 text-[var(--mp-info-text)]" aria-hidden />
        <p className="min-w-0 flex-1 text-[14px] text-[var(--mp-fg)]">{t('a22_guest_body', lang)}</p>
        <div className="flex items-center gap-1">
          <Link href="/login?mode=register" className="mp-btn mp-btn--secondary min-h-11 text-[14px]">
            <UserPlus className="w-4 h-4" aria-hidden />
            {t('a22_guest_cta', lang)}
          </Link>
          <IconButton label={t('a22_guest_dismiss', lang)} onClick={handleDismiss} />
        </div>
      </div>
    </section>
  )
}
