'use client'

import { useEffect, useState, useRef } from 'react'
import {
  EXAM_SOURCES,
  getStoredExamSource,
  setStoredExamSource,
  type ExamSourceId,
} from '@/lib/topics'

/**
 * Floating exam-type pill in the top-right corner of every page.
 *
 * Click to open a small dropdown and switch between Kenntnisprüfung / Pharma
 * / KoalaMed. Selection is persisted to localStorage (`medpruef_exam_source`)
 * — the existing key used by every page's fetch call for the `examSource`
 * query param — so the switch takes effect on the next data load.
 *
 * On switch, we soft-reload the page to force every on-screen query to
 * re-run against the new exam_type (no app-wide React Query / SWR store
 * exists, so a reload is the safest way to guarantee consistent UX).
 *
 * This is distinct from `ExamSelector.tsx`, which is the full-screen
 * onboarding picker shown to new users on their first visit.
 */
export default function ExamSwitcher() {
  const [active, setActive] = useState<ExamSourceId>('kenntnispruefung')
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Hydrate from localStorage after mount (avoid SSR mismatch)
  useEffect(() => {
    setActive(getStoredExamSource())
    setMounted(true)
  }, [])

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Hide on /landing, /login, /privacy, /terms, /impressum, /changelog, /about
  // where the switcher would be noise / collide with page chrome.
  const [shouldRender, setShouldRender] = useState(false)
  useEffect(() => {
    const hiddenPaths = ['/landing', '/login', '/privacy', '/terms', '/impressum', '/changelog', '/about']
    const path = window.location.pathname
    setShouldRender(!hiddenPaths.some(p => path === p || path.startsWith(p + '/')))
  }, [])

  if (!mounted || !shouldRender) return null

  const switchTo = (id: ExamSourceId) => {
    if (id === active) {
      setOpen(false)
      return
    }
    setActive(id)
    setStoredExamSource(id)
    setOpen(false)
    // Notify any same-page subscribers (optional)
    window.dispatchEvent(new CustomEvent('medpruef:examChanged', { detail: { examSource: id } }))
    // Soft reload so every page re-fetches with the new exam_type
    setTimeout(() => window.location.reload(), 50)
  }

  const activeExam = EXAM_SOURCES.find(e => e.id === active) ?? EXAM_SOURCES[0]

  return (
    <div ref={rootRef} className="fixed top-3 right-3 z-[60] select-none">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                   bg-white/90 dark:bg-slate-800/90 backdrop-blur
                   border border-slate-200 dark:border-slate-700
                   shadow-sm hover:shadow-md transition-all
                   text-xs font-medium text-slate-700 dark:text-slate-200"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Prüfung: ${activeExam.fullName}`}
      >
        <span className="text-sm leading-none">{activeExam.badge}</span>
        <span>{activeExam.shortLabel}</span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" className="opacity-60">
          <path d="M5 7l5 5 5-5H5z" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 w-64
                     bg-white dark:bg-slate-800
                     border border-slate-200 dark:border-slate-700
                     rounded-xl shadow-xl overflow-hidden"
          role="listbox"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
            Prüfung / Exam
          </div>
          {EXAM_SOURCES.map(exam => {
            const isActive = exam.id === active
            // koalamed is reserved — no questions imported yet
            const isComing = exam.id === 'koalamed'
            return (
              <button
                key={exam.id}
                onClick={() => !isComing && switchTo(exam.id)}
                disabled={isComing}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left
                            transition-colors
                            ${isActive
                              ? 'bg-[#00A896]/10 text-[#00A896]'
                              : isComing
                                ? 'opacity-40 cursor-not-allowed'
                                : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200'
                            }`}
                role="option"
                aria-selected={isActive}
              >
                <span className="text-lg mt-0.5 leading-none">{exam.badge}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <span className="truncate">{exam.label}</span>
                    {isActive && (
                      <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="flex-shrink-0">
                        <path d="M7.5 13.5L4 10l1.4-1.4 2.1 2.1 7-7L16 5.1z" />
                      </svg>
                    )}
                    {isComing && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 flex-shrink-0">
                        bald
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {exam.fullName}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
