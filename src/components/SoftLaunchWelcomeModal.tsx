'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Dialog } from '@/components/ui'
import { ShieldCheck, Gift, Users, Sparkles } from 'lucide-react'

/**
 * Soft-launch welcome modal — v1 (2026-04-23).
 *
 * First-visit announcement for the MedPrüf soft launch. Shown ONCE per
 * user (localStorage, versioned key so we can re-launch if positioning
 * changes materially). Runs AFTER WhatsNewModal so it doesn't double-
 * stack — WhatsNewModal reads its own storage key, and this modal only
 * fires if WhatsNewModal has already been seen (or the user is new
 * enough that the version hash matches).
 *
 * Message hierarchy:
 *   1. Pass first try — or study free until you do.  (PUYP guarantee)
 *   2. 150 free questions per exam — no credit card.  (low friction)
 *   3. Earn €25-75 per referral — €400 exam-fee rebate on pass.
 *   4. B2B cohort: Juni-26 Pharmakologie — limited seats.
 *
 * Does NOT fire for:
 *   - Guest users (they get account-creation nudge via GuestMigrationBanner)
 *   - Pre-onboarding users (they're already in a guided flow)
 *   - Users who've already dismissed this version
 */

const VERSION = '2026-04-23-soft-launch'
const STORAGE_KEY = 'medpruef_soft_launch_welcome_seen'
const WHATS_NEW_KEY = 'medpruef_whats_new_seen'
const WHATS_NEW_CURRENT = '2026-04-22'

interface Highlight {
  icon: React.ReactNode
  title: string
  description: string
}

const HIGHLIGHTS: Highlight[] = [
  {
    icon: <ShieldCheck className="w-5 h-5 text-[var(--mp-accent-teal)]" />,
    title: 'Pass first try — or study free until you do',
    description:
      'Lade deinen offiziellen Nicht-Bestanden-Bescheid hoch und wir verlängern dein Abo kostenlos bis zum nächsten Versuch. Keine Kleingedrucktes.',
  },
  {
    icon: <Gift className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    title: '150 Fragen pro Prüfung — gratis',
    description:
      'Kein Zahlungsmittel nötig. Teste uns ernsthaft, bevor du zahlst. Aktualisierte Fragen für Kenntnisprüfung Wien, KMP Innsbruck und Pharmakologie.',
  },
  {
    icon: <Users className="w-5 h-5 text-[#8B5CF6]" />,
    title: 'Empfiehl MedPrüf, verdiene €25–75 pro Anmeldung',
    description:
      'Plus €400 Prüfungsgebühren-Rückzahlung, wenn du die Prüfung beim ersten Anlauf bestehst. Keine versteckten Bedingungen.',
  },
  {
    icon: <Sparkles className="w-5 h-5 text-[#F4A261]" />,
    title: 'Juni-26-Pharmakologie-Kohorte',
    description:
      'Begrenzte Plätze für die Juni-26-Kohorte mit täglichen Übungssprints und einer simulierten Prüfung zwei Wochen vor dem Termin.',
  },
]

export default function SoftLaunchWelcomeModal() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('medpruef_session')
      if (!raw) return
      const session = JSON.parse(raw || '{}')
      const userId = session?.user?.id || ''
      if (!userId || userId.startsWith('guest_')) return

      // Post-onboarding only — new users get the onboarding flow first.
      const onboarding = JSON.parse(
        localStorage.getItem('medpruef_onboarding') || '{}'
      )
      if (!onboarding?.completedAt) return

      // Already dismissed this version?
      if (localStorage.getItem(STORAGE_KEY) === VERSION) return

      // Don't double-stack with WhatsNewModal. If WhatsNewModal hasn't been
      // seen yet, skip this round — WhatsNewModal has priority and we'll
      // catch them on next visit.
      if (localStorage.getItem(WHATS_NEW_KEY) !== WHATS_NEW_CURRENT) return

      // Small delay so it doesn't compete with page-load.
      const timer = setTimeout(() => setOpen(true), 2000)
      return () => clearTimeout(timer)
    } catch {
      // silent
    }
  }, [])

  const dismiss = () => {
    setOpen(false)
    try {
      localStorage.setItem(STORAGE_KEY, VERSION)
    } catch {}
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
        else setOpen(true)
      }}
      title="Willkommen bei MedPrüf — Soft Launch"
      description="Vier Dinge, die du wissen solltest, bevor du weiterlernst."
      maxWidth="500px"
      footer={
        <div className="flex flex-col sm:flex-row gap-2 w-full">
          <Link
            href="/pricing?utm_source=soft_launch_modal&utm_medium=modal&utm_campaign=welcome_v1"
            onClick={dismiss}
            className="mp-btn mp-btn--primary mp-btn--lg flex-1 text-center"
          >
            Pläne ansehen
          </Link>
          <button
            onClick={dismiss}
            className="mp-btn mp-btn--secondary mp-btn--lg flex-1"
          >
            Weiterlernen
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {HIGHLIGHTS.map((h, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-10 h-10 rounded-[var(--mp-r-card)] bg-[var(--mp-surface-sunken)] flex items-center justify-center flex-shrink-0">
              {h.icon}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--mp-fg)]">
                {h.title}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5 leading-relaxed">
                {h.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
