'use client'

import { useEffect, useState } from 'react'
import { X, Mountain, Pill, Calendar, Target, Star, MessageSquarePlus } from 'lucide-react'

const CURRENT_VERSION = '2026-04-12'
const STORAGE_KEY = 'medpruef_whats_new_seen'

interface Feature {
  icon: React.ReactNode
  title: string
  description: string
}

const FEATURES: Feature[] = [
  {
    icon: <Mountain className="w-5 h-5 text-[#003A8C]" />,
    title: 'KMP Innsbruck — 3.091 new questions',
    description: 'The Cumulative Module Exam (KMP) from Med Uni Innsbruck is now available. Switch exams via the sidebar.',
  },
  {
    icon: <Pill className="w-5 h-5 text-[#8B5CF6]" />,
    title: 'Pharmacology exam — 335 questions',
    description: 'Short-answer pharmacology questions for Rezeptierkunde preparation.',
  },
  {
    icon: <Calendar className="w-5 h-5 text-[#00A896]" />,
    title: 'February 2026 SIP5a exam added',
    description: '154 fresh questions from the latest Vienna exam, organized by specialty.',
  },
  {
    icon: <Target className="w-5 h-5 text-[#F4A261]" />,
    title: 'Exam simulation redesigned',
    description: 'Select answers freely, navigate between questions, and submit when ready — just like the real exam.',
  },
  {
    icon: <Star className="w-5 h-5 text-[#D64545]" />,
    title: 'Bookmarks & mistake review',
    description: 'Quick access on the home page to your saved questions and questions you got wrong.',
  },
  {
    icon: <MessageSquarePlus className="w-5 h-5 text-[#003A8C]" />,
    title: 'Feedback button',
    description: 'See the blue button at the bottom-right? Use it to report issues or suggest improvements. We read every message.',
  },
]

/**
 * One-time modal announcing new features to returning users.
 * Shows once per version — dismisses permanently on "Got it".
 *
 * Only shows for logged-in non-guest users who have completed onboarding.
 */
export default function WhatsNewModal() {
  const [show, setShow] = useState(false)

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
      const timer = setTimeout(() => setShow(true), 1500)
      return () => clearTimeout(timer)
    } catch {} // silent
  }, [])

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    localStorage.setItem(STORAGE_KEY, CURRENT_VERSION)
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center px-4" onClick={dismiss}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-y-auto animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-[#001B3D] to-[#003A8C] text-white p-5 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold">What&apos;s New in MedPrüf</h2>
              <p className="text-white/60 text-xs mt-0.5">April 2026 Update</p>
            </div>
            <button onClick={dismiss} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Features */}
        <div className="p-5 space-y-4">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F7F9FC] dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                {f.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1A2B3C] dark:text-white">{f.title}</p>
                <p className="text-xs text-[#A0AEC0] mt-0.5 leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="p-5 pt-0">
          <button
            onClick={dismiss}
            className="w-full py-3 bg-[#003A8C] text-white rounded-xl font-bold text-sm hover:bg-[#003A8C]/90 transition-colors active:scale-[0.98]"
          >
            Got it — let&apos;s study! 🎓
          </button>
        </div>
      </div>
    </div>
  )
}
