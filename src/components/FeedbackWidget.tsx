'use client'

import { useFocusMode } from '@/lib/focus-mode'
import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, X, Send, Check } from 'lucide-react'
import { getStoredExamSource } from '@/lib/topics'
import { authFetch as fetch } from '@/lib/authFetch'
import { t, useLang } from '@/lib/i18n'
import { announce } from '@/lib/announce'
import { OPEN_FEEDBACK_EVENT } from '@/components/nav/MoreSheet'
import { feedbackSource } from '@/components/mentor/entries/feedback-source'

/**
 * First-party feedback form and launcher (UX-GLOBAL-28).
 *
 * - The form opens from the floating launcher on desktop, from "Feedback und
 *   Hilfe" in the Mehr sheet and Sidebar (OPEN_FEEDBACK_EVENT), and from any
 *   in-page "Feedback geben" row that dispatches the same event.
 * - Phones (under 1024 px): no launcher on the study surfaces /quiz,
 *   /flashcards and /exam (their question action row carries "Problem
 *   melden", and the Mehr sheet carries "Feedback und Hilfe"). Elsewhere on
 *   phones the launcher is the 40 px edge-aligned interim (HOME-47) until the
 *   in-quiz entry is confirmed live on a real device; then PHONE_FAB_RETIRED
 *   flips to true and phones keep only the Mehr entry.
 * - Never in focus mode (the running exam does not mount it).
 * - Hidden on /landing, /login, /admin, /privacy, /terms, /impressum.
 * - The form closes only on a button press or Escape, never on a route
 *   change (UX-ACC-44); focus then returns to the launcher, or to the control
 *   that opened it when the launcher is not shown. Results are spoken once
 *   through announce() and shown inline; the thanks card is role=status.
 */

const MOBILE_MQ = '(max-width: 1024px)'
/** Flip after the real-device check of the in-quiz feedback entry (release.md). */
export const PHONE_FAB_RETIRED = false
// /mentor: answers carry their own report control (MUX-48), so phones show no launcher there.
// UX-STU-05 (a25): the study screens too; feedback stays one tap away in the Mehr sheet and the Sidebar ("Feedback und Hilfe").
const PHONE_STUDY_ROUTES = ['/quiz', '/flashcards', '/exam', '/mistakes', '/pricing', '/settings', '/checkout/success', '/mentor', '/study-plan', '/curriculum', '/progress', '/stats', '/library']
const HIDDEN_ROUTES = ['/landing', '/login', '/admin', '/privacy', '/terms', '/impressum']

export default function FeedbackWidget() {
  const focusMode = useFocusMode()
  const lang = useLang()
  const [open, setOpen] = useState(false) // feedback panel open
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [sending, setSending] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  // Reactive pathname — fires on every App Router navigation so the widget
  // hides/shows correctly after navigation (Frontend P1-3, 2026-04-15).
  const pathname = usePathname()

  useEffect(() => { setMounted(true) }, [])

  // Keep the launcher above the fixed bottom navigation on smaller screens.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (open && textRef.current) textRef.current.focus()
  }, [open])

  // Focus return on close: the launcher when it is shown again, otherwise the
  // control that opened the form (Mehr sheet, Sidebar or an in-page row).
  useEffect(() => {
    if (open) { wasOpenRef.current = true; return }
    if (!wasOpenRef.current) return
    wasOpenRef.current = false
    const opener = openerRef.current
    openerRef.current = null
    requestAnimationFrame(() => {
      if (launcherRef.current) launcherRef.current.focus()
      else if (opener && opener.isConnected) opener.focus()
    })
  }, [open])

  // Non-modal popover: Escape closes it (ADM-39 popover rule).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Opened from the Mehr sheet, the Sidebar or an in-page "Feedback geben" row.
  useEffect(() => {
    const openForm = () => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setSent(false)
      setOpen(true)
    }
    window.addEventListener(OPEN_FEEDBACK_EVENT, openForm)
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, openForm)
  }, [])

  if (!mounted || focusMode) return null
  if (HIDDEN_ROUTES.some(p => pathname?.startsWith(p))) return null

  // Phones: never over the study surfaces (and money/settings screens);
  // elsewhere the 40 px interim launcher until PHONE_FAB_RETIRED.
  const launcherVisible = pathname !== '/exam' && !(isMobile && (PHONE_FAB_RETIRED || PHONE_STUDY_ROUTES.some(p => pathname?.startsWith(p))))

  const handleSubmit = async () => {
    if (!message.trim() || sending) return
    setSending(true)
    setSubmitError(false)
    try {
      // Auto-capture context
      const context = {
        pathname: window.location.pathname,
        examType: getStoredExamSource(),
        userAgent: navigator.userAgent.slice(0, 200),
        screenSize: `${window.innerWidth}x${window.innerHeight}`,
        timestamp: new Date().toISOString(),
        ...(feedbackSource(window.location.pathname) ? { source: feedbackSource(window.location.pathname) } : {}),
        // Try to grab the current question ID from the page if on quiz/exam
        questionId: (() => {
          try {
            const el = document.querySelector('[data-question-id]')
            return el?.getAttribute('data-question-id') || null
          } catch { return null }
        })(),
      }

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), context }),
      })
      if (!response.ok) throw new Error('Feedback submission failed')

      setSent(true)
      setMessage('')
      announce(t('feedback_thanks_title', lang))
    } catch {
      setSubmitError(true)
      announce(t('feedback_send_failed', lang), 'assertive')
    } finally {
      setSending(false)
    }
  }

  const openFeedback = () => {
    openerRef.current = launcherRef.current
    setOpen(true)
  }

  // The feedback panel.
  //   - Mobile: bottom:96px (clears the bottom-nav), shared with the launcher.
  const mobileOffset = 'bottom-[calc(var(--mobile-nav-clearance)+0.75rem)]'
  const feedbackPanel = open && (
    <div role="dialog" aria-modal="false" aria-label={t('feedback_title', lang)} className={`fixed mp-layer-sheet w-80 max-w-[calc(100vw-2rem)] max-h-[min(70dvh,32rem)] overflow-y-auto ${isMobile ? `${mobileOffset} right-4` : 'bottom-6 right-6'}`}>
      <div className="bg-[var(--mp-surface-raised)] rounded-2xl shadow-2xl border border-[var(--mp-border-subtle)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-1 bg-[var(--mp-action-primary)] text-[var(--mp-fg-on-cta-blue)]">
          <span className="text-sm font-semibold">{t('feedback_title', lang)}</span>
          <button
            onClick={() => setOpen(false)}
            className="hover:bg-white/20 rounded-lg w-11 h-11 -mr-3 flex items-center justify-center transition-colors"
            aria-label={t('feedback_close', lang)}
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {sent ? (
          <div className="p-6 text-center" role="status">
            <Check className="w-8 h-8 text-[var(--mp-viridian)] mx-auto mb-2" aria-hidden />
            <p className="text-sm font-medium text-[var(--mp-fg)]">{t('feedback_thanks_title', lang)}</p>
            <p className="text-[13px] text-[var(--mp-fg-muted)] mt-1">{t('feedback_thanks_body', lang)}</p>
            <button type="button" onClick={() => { setSent(false); setOpen(false) }} className="mp-btn mp-btn--secondary mt-4">{t('feedback_close', lang)}</button>
          </div>
        ) : (
          <div className="p-4">
            <textarea
              ref={textRef}
              value={message}
              onChange={e => { setMessage(e.target.value); setSubmitError(false) }}
              placeholder={t('feedback_placeholder', lang)}
              aria-label={t('feedback_textarea_aria', lang)}
              className="w-full h-24 text-sm bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] border border-[var(--mp-border-subtle)] rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[var(--mp-cta-blue)]/50"
              maxLength={2000}
            />
            {submitError && (
              <p className="mt-2 text-[13px] text-[var(--mp-error-text)]">
                {t('feedback_send_failed', lang)}
              </p>
            )}
            <div className="flex items-center justify-between mt-2">
              <span className="text-[12px] text-[var(--mp-fg-subtle)]">
                {t('feedback_context_hint', lang)}
              </span>
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || sending}
                className="mp-btn mp-btn--primary mp-btn--sm"
              >
                <Send className="w-3.5 h-3.5" aria-hidden />
                {sending ? t('feedback_sending', lang) : t('feedback_send', lang)}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {!open && launcherVisible && (
        <button
          ref={launcherRef}
          type="button"
          onClick={openFeedback}
          className={`fixed ${isMobile ? `${mobileOffset} right-2 w-10 h-10 mp-hit` : 'bottom-6 right-6 w-11 h-11'} mp-layer-sticky rounded-full bg-[var(--mp-action-primary)] text-[var(--mp-fg-on-cta-blue)] shadow-lg hover:shadow-xl transition-all flex items-center justify-center active:scale-95`}
          title={t('feedback_button_title', lang)}
          aria-label={t('feedback_button_title', lang)}
        >
          <MessageSquarePlus className="w-5 h-5" aria-hidden />
        </button>
      )}
      {feedbackPanel}
    </>
  )
}
