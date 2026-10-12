'use client'
import { t, useLang } from '@/lib/i18n'

import { useEffect, useId, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { authFetch as fetch } from '@/lib/authFetch'
import {
  EXAM_SOURCES,
  getStoredExamSource,
  setStoredExamSource,
  type ExamSourceId,
} from '@/lib/topics'
import { examChipAccessibleName, getExamLabel } from '@/lib/master-locale/exam-label'
import { EXAM_CHANGED_EVENT, switchActiveExam } from '@/lib/exam-switch'

/**
 * Inline exam-type switcher. The trigger fits any header or sidebar; the
 * choice opens in the shared ui/Dialog (bottom sheet on phones, centred on
 * desktop) as a native radio group, a persistent single choice
 * (UX-GLOBAL-14/23).
 *
 * Variants:
 *   - "sidebar":  dark surface for the sidebar user-card area
 *   - "header":   light surface for page top-bars (home, progress, etc.)
 *   - "compact":  icon-only pill (mobile / tight spaces)
 *
 * On switch, saves the account preference first (rollback on failure), then
 * sends the examChanged event: Home refreshes in place, other pages reload
 * (src/lib/exam-switch.ts). The legacy full-screen ExamSelector flow is no
 * longer triggered.
 */
interface Props {
  variant?: 'sidebar' | 'header' | 'compact'
  className?: string
}

export default function ExamSwitcherInline({ variant = 'header', className = '' }: Props) {
  const lang = useLang();
  const [active, setActive] = useState<ExamSourceId>('kenntnispruefung')
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const groupName = useId()

  useEffect(() => {
    setActive(getStoredExamSource())
    setMounted(true)
    let alive = true
    try {
      const session = localStorage.getItem('medpruef_session')
      const parsed = session ? JSON.parse(session) : null
      const userId = parsed?.user?.id
      if (userId && !userId.startsWith('guest_')) {
        fetch('/api/user/exam-preference')
          .then(async (res) => {
            if (!res.ok) throw new Error('Could not read preference')
            return res.json()
          })
          .then((data) => {
            if (!alive || !EXAM_SOURCES.some((item) => item.id === data?.activeExam)) return
            const serverValue = data.activeExam as ExamSourceId
            setActive(serverValue)
            setStoredExamSource(serverValue)
          })
          .catch(() => { /* local preference remains the offline fallback */ })
      }
    } catch { /* storage may be unavailable in restricted browser contexts */ }
    return () => { alive = false }
  }, [])

  // Keep the chip in step when another switcher (or Home's server read) changes the exam.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const next = (e as CustomEvent<{ examSource?: ExamSourceId }>).detail?.examSource
      if (next && EXAM_SOURCES.some((item) => item.id === next)) setActive(next)
    }
    window.addEventListener(EXAM_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(EXAM_CHANGED_EVENT, onChanged)
  }, [])

  if (!mounted) {
    // Render an invisible placeholder with the same dimensions to avoid layout shift
    return <div className={`h-9 ${className}`} aria-hidden />
  }

  const switchTo = async (id: ExamSourceId) => {
    if (id === active) {
      setOpen(false)
      return
    }
    const previous = active
    setSaveError(false)
    setActive(id)
    setOpen(false)
    // UX-HOME-12: one save path with rollback; Home refreshes in place, other pages reload.
    if (await switchActiveExam(id, previous) === 'failed') {
      setSaveError(true)
      setActive(previous)
    }
  }

  const activeExam = EXAM_SOURCES.find(e => e.id === active) ?? EXAM_SOURCES[0]

  // ─── Button styles per variant ───
  const btnClass = (() => {
    if (variant === 'sidebar') {
      return 'w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/[0.08] transition-colors text-sm text-white'
    }
    if (variant === 'compact') {
      return 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--mp-viridian)]/10 hover:bg-[var(--mp-viridian)]/20 border border-[var(--mp-viridian)]/20 text-xs font-mono text-[var(--mp-viridian)] transition-colors'
    }
    // header
    return 'flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--mp-viridian)]/10 hover:bg-[var(--mp-viridian)]/20 border border-[var(--mp-viridian)]/20 text-sm font-medium text-[var(--mp-viridian)] transition-colors'
  })()

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnClass}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${t("home_exam", lang)}: ${getExamLabel(activeExam.id, 'full', lang)}`}
        aria-label={variant === 'compact' ? examChipAccessibleName(activeExam.id, lang) : undefined}
      >
        <span className="truncate">
          {variant === 'compact' ? getExamLabel(activeExam.id, 'short') : getExamLabel(activeExam.id, 'full', lang)}
        </span>
        <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" className="flex-shrink-0" aria-hidden>
          <path d="M5 7l5 5 5-5H5z" />
        </svg>
      </button>
      {saveError && (
        <p className="mt-1 text-[13px] text-[var(--mp-error-text)]">
          {t("home_exam_save_error", lang)}
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen} title={t("home_exam", lang)} placement="auto" kind="content">
        <fieldset className="border-0 p-0 m-0">
          <legend className="mp-sr-only">{t("home_exam", lang)}</legend>
          <div className="flex flex-col gap-2">
            {EXAM_SOURCES.map(exam => {
              const isActive = exam.id === active
              return (
                <label key={exam.id} className={`mp-choice-row ${isActive ? 'mp-choice-row--checked' : ''}`}>
                  <input
                    type="radio"
                    name={groupName}
                    value={exam.id}
                    checked={isActive}
                    // Arrow keys only move the focus inside the group; a
                    // click, Enter or Space commits the switch.
                    onChange={() => { /* committed on click, Enter or Space */ }}
                    // Pointer, label and Space activation all arrive as a click.
                    onClick={() => void switchTo(exam.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void switchTo(exam.id) }
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        const radios = Array.from((e.currentTarget.closest('fieldset') ?? document).querySelectorAll<HTMLInputElement>('input[type="radio"]'))
                        const i = radios.indexOf(e.currentTarget)
                        const next = radios[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : radios.length - 1)) % radios.length]
                        next?.focus()
                      }
                    }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold text-[var(--mp-fg)]">{getExamLabel(exam.id, 'full', lang)}</span>
                    <span className="block text-[13px] text-[var(--mp-fg-muted)]">{getExamLabel(exam.id, 'bridge', lang)}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      </Dialog>
    </div>
  )
}
