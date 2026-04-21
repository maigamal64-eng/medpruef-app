'use client'

import { useEffect, useState } from 'react'
import { Mountain, Pill, Calendar, Target, Star, MessageSquarePlus, WifiOff, Search, Languages } from 'lucide-react'
import { Dialog } from '@/components/ui'

const CURRENT_VERSION = '2026-04-22'
const STORAGE_KEY = 'medpruef_whats_new_seen'

interface Feature {
  icon: React.ReactNode
  title: string
  description: string
}

const FEATURES: Feature[] = [
  {
    icon: <WifiOff className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    title: 'Offline-Modus ist live — Fragen vorab herunterladen',
    description: 'Laden Sie 100–500 Fragen vorab in Einstellungen → Offline-Modus. Dann können Sie im Zug, im Flugzeug oder in der Kaffeepause lernen, auch ohne WLAN. Ihre Antworten werden synchronisiert, sobald Sie wieder online sind.',
  },
  {
    icon: <Search className="w-5 h-5 text-[var(--mp-accent-teal)]" />,
    title: 'Schnellsuche mit Cmd+K',
    description: 'Drücken Sie Cmd+K (Mac) oder Strg+K (Windows), um sofort die Volltextsuche über alle 10.993 Fragen zu öffnen — ohne Mausklick, von jeder Seite aus.',
  },
  {
    icon: <Languages className="w-5 h-5 text-[#8B5CF6]" />,
    title: 'Erklärungen in 7 Sprachen',
    description: 'Sie können jede Erklärung jetzt auf Russisch, Arabisch, Englisch, Französisch, Türkisch, Ukrainisch oder Serbisch lesen. Medizinische Fachbegriffe, Medikamentennamen und Leitlinien-Bezüge bleiben dabei erhalten.',
  },
  {
    icon: <Mountain className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    title: 'KMP Innsbruck — 3.091 neue Fragen',
    description: 'Die Kumulative Modulprüfung (KMP) der Med Uni Innsbruck ist jetzt verfügbar. Wechseln Sie die Prüfung über die Seitenleiste.',
  },
  {
    icon: <Pill className="w-5 h-5 text-[#8B5CF6]" />,
    title: 'Pharmacology exam — 335 questions',
    description: 'Short-answer pharmacology questions for Rezeptierkunde preparation.',
  },
  {
    icon: <Calendar className="w-5 h-5 text-[var(--mp-accent-teal)]" />,
    title: 'February 2026 SIP5a exam added',
    description: '154 fresh questions from the latest Vienna exam, organized by specialty.',
  },
  {
    icon: <Target className="w-5 h-5 text-[#D68A3A]" />,
    title: 'Exam simulation redesigned',
    description: 'Select answers freely, navigate between questions, and submit when ready — just like the real exam.',
  },
  {
    icon: <Star className="w-5 h-5 text-[var(--mp-error)]" />,
    title: 'Bookmarks & mistake review',
    description: 'Quick access on the home page to your saved questions and questions you got wrong.',
  },
  {
    icon: <MessageSquarePlus className="w-5 h-5 text-[var(--mp-cta-blue)]" />,
    title: 'Feedback button',
    description: 'See the blue button at the bottom-right? Use it to report issues or suggest improvements. We read every message.',
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

  useEffect(() => {
    // Don't show if: no session, guest, or already seen this version
    try {
      const session = JSON.parse(localStorage.getItem('medpruef_session') || '{}')
      const userId = session?.user?.id || ''
      if (!userId || userId.startsWith('guest_')) return

      const onboarding = JSON.parse(localStorage.getItem('medpruef_onboarding') || '{}')
      if (!onboarding?.completedAt) return // don't show before onboarding

      const lastSeen = localStorage.getItem(STORAGE_KEY)
      if (lastSeen === CURRENT_VERSION) return

      // Small delay so it doesn't compete with page load
      const timer = setTimeout(() => setOpen(true), 1500)
      return () => clearTimeout(timer)
    } catch {
      // silent
    }
  }, [])

  const dismiss = () => {
    setOpen(false)
    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
        else setOpen(true)
      }}
      title="What's New in MedPrüf"
      description="April 2026 Update"
      maxWidth="480px"
      footer={
        <button onClick={dismiss} className="mp-btn mp-btn--primary mp-btn--lg" style={{ width: '100%' }}>
          Got it — let&apos;s study
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
              <p className="text-sm font-semibold text-[var(--mp-fg)]">{f.title}</p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5 leading-relaxed">{f.description}</p>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
