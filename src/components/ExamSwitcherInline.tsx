'use client'

import { useEffect, useState, useRef } from 'react'
import { authFetch as fetch } from '@/lib/authFetch'
import {
  EXAM_SOURCES,
  getStoredExamSource,
  setStoredExamSource,
  type ExamSourceId,
} from '@/lib/topics'

/**
 * Inline exam-type dropdown. Meant to be dropped into an existing header or
 * sidebar — no fixed positioning, fits the flow of whatever parent contains
 * it. The dropdown panel is absolutely positioned relative to the button.
 *
 * Variants:
 *   - "sidebar":  dark surface for the sidebar user-card area
 *   - "header":   light surface for page top-bars (home, progress, etc.)
 *   - "compact":  icon-only pill (mobile / tight spaces)
 *
 * On switch, persists to localStorage (`medpruef_exam_source`) and soft-reloads
 * so every on-screen query refetches against the new exam_type. The legacy
 * full-screen ExamSelector flow is no longer triggered.
 */
interface Props {
  variant?: 'sidebar' | 'header' | 'compact'
  className?: string
}

export default function ExamSwitcherInline({ variant = 'header', className = '' }: Props) {
  const [active, setActive] = useState<ExamSourceId>('kenntnispruefung')
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setActive(getStoredExamSource())
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!mounted) {
    // Render an invisible placeholder with the same dimensions to avoid layout shift
    return <div className={`h-9 ${className}`} aria-hidden />
  }

  const switchTo = (id: ExamSourceId) => {
    if (id === active) {
      setOpen(false)
      return
    }
    setActive(id)
    setStoredExamSource(id)
    setOpen(false)

    // Persist to server for logged-in users (fire-and-forget)
    try {
      const session = localStorage.getItem('medpruef_session')
      const parsed = session ? JSON.parse(session) : null
      const userId = parsed?.user?.id
      if (userId && !userId.startsWith('guest_')) {
        fetch('/api/user/exam-preference', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, activeExam: id }),
        }).catch(() => {}) // non-blocking
      }
    } catch {} // localStorage read can fail in some contexts

    window.dispatchEvent(new CustomEvent('medpruef:examChanged', { detail: { examSource: id } }))
    setTimeout(() => window.location.reload(), 50)
  }

  const activeExam = EXAM_SOURCES.find(e => e.id === active) ?? EXAM_SOURCES[0]

  // ─── Button styles per variant ───
  const btnClass = (() => {
    if (variant === 'sidebar') {
      return 'w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/[0.08] transition-colors text-sm text-white'
    }
    if (variant === 'compact') {
      return 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#007B5F]/10 hover:bg-[#007B5F]/20 border border-[#007B5F]/20 text-xs font-mono text-[#007B5F] transition-colors'
    }
    // header
    return 'flex items-center gap-2 px-3 py-2 rounded-lg bg-[#007B5F]/10 hover:bg-[#007B5F]/20 border border-[#007B5F]/20 text-sm font-medium text-[#007B5F] transition-colors'
  })()

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        ref={btnRef}
        onClick={() => {
          if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect()
            // Position dropdown below the button, clamped to viewport
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - 272))
            setDropdownPos({ top: rect.bottom + 8, left })
          }
          setOpen(o => !o)
        }}
        className={btnClass}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Prüfung: ${activeExam.fullName}`}
      >
        <span className="text-base leading-none">{activeExam.badge}</span>
        <span className="truncate">
          {variant === 'compact' ? activeExam.shortLabel : activeExam.label}
        </span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" className="opacity-60 flex-shrink-0">
          <path d="M5 7l5 5 5-5H5z" />
        </svg>
      </button>

      {open && dropdownPos && (
        <div
          className="fixed w-64 bg-white dark:bg-slate-800
                     border border-slate-200 dark:border-slate-700
                     rounded-xl shadow-xl overflow-hidden"
          style={{ top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
          role="listbox"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
            Prüfung / Exam
          </div>
          {EXAM_SOURCES.map(exam => {
            const isActive = exam.id === active
            const isComing = false // all exams are now live
            return (
              <button
                key={exam.id}
                onClick={() => !isComing && switchTo(exam.id)}
                disabled={isComing}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors
                            ${isActive
                              ? 'bg-[#00A896]/10 text-[#00A896]'
                              : isComing
                                ? 'opacity-40 cursor-not-allowed text-slate-700 dark:text-slate-200'
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
                  {exam.questions > 0 && (
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                      {exam.questions.toLocaleString('de-DE')} Fragen
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
