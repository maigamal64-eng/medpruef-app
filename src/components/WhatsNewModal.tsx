'use client'

import { useEffect, useState } from 'react'
import { Mountain, Pill, Calendar, Target, Star, MessageSquarePlus, WifiOff, Search, Languages } from 'lucide-react'
import { Dialog } from '@/components/ui'
import { t, useLang, type TranslationKey } from '@/lib/i18n'
import { fetchAnnouncementState, forgetAnnouncementState } from '@/lib/announcements/useAnnouncementGate'
import { dismissSurface, useAnnouncementSlot } from '@/lib/announcements/queue'
// authFetch (aliased to `fetch`) adds the signed `x-session-token` header
// that the `requireUser`-guarded /api/announcements/seen endpoint verifies
// (B-22). The bare `fetch` here silently 401'd, so whats_new_seen_at never
// got written and the cross-device "already saw What's-New" suppression
// (the whatsNewSeenAt check above) never worked.
import { authFetch as fetch } from '@/lib/authFetch'
import { safeStorage } from "@/lib/safe-storage";

const CURRENT_VERSION = '2026-04-22'
const STORAGE_KEY = 'medpruef_whats_new_seen'
/**
 * HOME-41 / ONB-34 (a12): the April 2026 modal is retired. A What's New modal
 * opens only for an entry flagged as a highlight (set this to its version);
 * ordinary entries live on /changelog. Until then the modal never opens.
 */
const HIGHLIGHT_VERSION: string | null = null

interface Feature {
  icon: React.ReactNode
  titleKey: TranslationKey
  bodyKey: TranslationKey
}

const FEATURES: Feature[] = [
  {
    icon: <WifiOff className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    titleKey: 'whatsnew_offline_title',
    bodyKey: 'whatsnew_offline_body',
  },
  {
    icon: <Search className="w-5 h-5 text-[var(--mp-accent-teal)]" />,
    titleKey: 'whatsnew_search_title',
    bodyKey: 'whatsnew_search_body',
  },
  {
    icon: <Languages className="w-5 h-5 text-[#8B5CF6]" />,
    titleKey: 'whatsnew_translations_title',
    bodyKey: 'whatsnew_translations_body',
  },
  {
    icon: <Mountain className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    titleKey: 'whatsnew_kmp_title',
    bodyKey: 'whatsnew_kmp_body',
  },
  {
    icon: <Pill className="w-5 h-5 text-[#8B5CF6]" />,
    titleKey: 'whatsnew_pharma_title',
    bodyKey: 'whatsnew_pharma_body',
  },
  {
    icon: <Calendar className="w-5 h-5 text-[var(--mp-accent-teal)]" />,
    titleKey: 'whatsnew_sip5a_title',
    bodyKey: 'whatsnew_sip5a_body',
  },
  {
    icon: <Target className="w-5 h-5 text-[#D68A3A]" />,
    titleKey: 'whatsnew_examsim_title',
    bodyKey: 'whatsnew_examsim_body',
  },
  {
    icon: <Star className="w-5 h-5 text-[var(--mp-error)]" />,
    titleKey: 'whatsnew_bookmarks_title',
    bodyKey: 'whatsnew_bookmarks_body',
  },
  {
    icon: <MessageSquarePlus className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    titleKey: 'whatsnew_feedback_title',
    bodyKey: 'whatsnew_feedback_body',
  },
]

/**
 * One-time modal announcing new features to returning users.
 * Shows once per version — dismisses permanently on "Got it".
 *
 * Migrated to MPDS Dialog primitive (2026-04-19). The shared `<Dialog>`
 * handles a11y (focus trap, escape, aria-modal, return focus on close)
 * that every hand-rolled modal was missing.
 *
 * Only shows for logged-in non-guest users who have completed onboarding.
 */
export default function WhatsNewModal() {
  const [open, setOpen] = useState(false)
  const lang = useLang()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    ;(async () => {
      // Don't show if: no session, guest, already seen this version
      // locally, OR (review-2026-04-26-A3) the cross-device gate says
      // we already showed it on another device.
      try {
        if (HIGHLIGHT_VERSION !== CURRENT_VERSION) return
        const session = JSON.parse(safeStorage.getItem('medpruef_session') || '{}')
        const userId = session?.user?.id || ''
        if (!userId || userId.startsWith('guest_')) return

        const onboarding = JSON.parse(safeStorage.getItem('medpruef_onboarding') || '{}')
        if (!onboarding?.completedAt) return

        const lastSeen = safeStorage.getItem(STORAGE_KEY)
        if (lastSeen === CURRENT_VERSION) return

        // Shared in-flight-deduped fetch (B-09) — was a bare
        // `fetch('/api/announcements/state')` that carried no session
        // token and so effectively always 401'd into the legacy path.
        // Now it shares the one authenticated GET the gate already
        // fires, so the cross-device whatsNewSeenAt check actually runs.
        try {
          const body = await fetchAnnouncementState()
          if (body?.state?.whatsNewSeenAt) {
            try { safeStorage.setItem(STORAGE_KEY, CURRENT_VERSION) } catch {}
            return
          }
          // ONB-34: never in the first two sessions.
          if (!body?.state || body.state.sessionCount < 3) return
        } catch { /* fall through to legacy behaviour */ }

        if (cancelled) return
        timer = setTimeout(() => {
          if (!cancelled) setOpen(true)
        }, 1500)
      } catch {
        // silent
      }
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  // UX-GLOBAL-12: one unrequested modal per session, through the queue.
  const visible = useAnnouncementSlot('whats_new', open)

  const dismiss = () => {
    setOpen(false)
    dismissSurface('whats_new', 'no_interest')
    safeStorage.setItem(STORAGE_KEY, CURRENT_VERSION)
    forgetAnnouncementState()
    fetch('/api/announcements/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface: 'whats_new_seen' }),
    }).catch(() => {})
  }

  return (
    <Dialog
      open={visible}
      onOpenChange={(next) => {
        if (!next) dismiss()
        else setOpen(true)
      }}
      title={t('whats_new_title', lang)}
      description={t('whats_new_subtitle', lang)}
      maxWidth="480px"
      footer={
        <button onClick={dismiss} className="mp-btn mp-btn--primary mp-btn--lg" style={{ width: '100%' }}>
          {t('whats_new_dismiss', lang)}
        </button>
      }
    >
      <div className="space-y-4">
        {FEATURES.map((f, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-10 h-10 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] flex items-center justify-center flex-shrink-0">
              {f.icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--mp-fg)]">{t(f.titleKey, lang)}</p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5 leading-relaxed">{t(f.bodyKey, lang)}</p>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
