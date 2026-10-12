'use client'

import { useFocusMode } from '@/lib/focus-mode'
import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, X, Send, Check } from 'lucide-react'
import { getStoredExamSource } from '@/lib/topics'
import { authFetch as fetch } from '@/lib/authFetch'
import { t, useLang } from '@/lib/i18n'

/**
 * First-party feedback launcher. The same form is available on desktop and
 * mobile, above the mobile navigation when necessary.
 *
 * Hidden on /landing, /login, /admin, /privacy, /terms, /impressum (unchanged).
 */

const MOBILE_MQ = '(max-width: 1024px)'

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
  const lastPathnameRef = useRef<string | null>(null)
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

  // Close the form on route changes, but keep the initial mount from
  // racing with a user's first click on the launcher.
  useEffect(() => {
    if (lastPathnameRef.current && lastPathnameRef.current !== pathname) {
      setOpen(false)
    }
    lastPathnameRef.current = pathname ?? null
  }, [pathname])

  if (!mounted || focusMode || pathname === "/exam") return null

  // Hide on certain pages
  if (['/landing', '/login', '/admin', '/privacy', '/terms', '/impressum'].some(p => pathname?.startsWith(p))) {
    return null
  }

  // The floating launcher can cover interactive controls on narrow pricing
  // cards and the Settings language picker. Keep the FAB out of those
  // phone/tablet layouts; it remains available on learner study screens.
  if ((pathname?.startsWith('/checkout/success') || pathname?.startsWith('/pricing') || pathname?.startsWith('/settings') || pathname?.startsWith('/mistakes')) && isMobile) return null

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
      setTimeout(() => {
        setSent(false)
        setOpen(false)
      }, 2000)
    } catch {
      setSubmitError(true)
    } finally {
      setSending(false)
    }
  }

  const openFeedback = () => {
    setOpen(true)
  }

  // The feedback panel.
  //   - Mobile: bottom:96px (clears the bottom-nav), shared with the launcher.
  const mobileOffset = 'bottom-[calc(var(--mobile-nav-clearance)+0.75rem)]'
  const feedbackPanel = open && (
    <div className={`fixed z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[min(70dvh,32rem)] overflow-y-auto ${isMobile ? `${mobileOffset} right-4` : 'bottom-6 right-6'}`}>
      <div className="bg-[var(--mp-surface-raised)] rounded-2xl shadow-2xl border border-[var(--mp-border-subtle)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--mp-cta-blue)] text-white">
          <span className="text-sm font-semibold">{t('feedback_title', lang)}</span>
          <button
            onClick={() => setOpen(false)}
            className="hover:bg-white/20 rounded p-1 transition-colors"
            aria-label={t('feedback_close', lang)}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {sent ? (
          <div className="p-6 text-center">
            <Check className="w-8 h-8 text-[var(--mp-accent-teal)] mx-auto mb-2" />
            <p className="text-sm font-medium text-[var(--mp-fg)]">{t('feedback_thanks_title', lang)}</p>
            <p className="text-xs text-[var(--mp-fg-subtle)] mt-1">{t('feedback_thanks_body', lang)}</p>
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
              <p role="alert" className="mt-2 text-xs text-[var(--mp-error)]">
                {lang === 'de'
                  ? 'Feedback konnte nicht gesendet werden. Bitte versuche es erneut.'
                  : 'Feedback could not be sent. Please try again.'}
              </p>
            )}
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-[var(--mp-fg-subtle)]">
                {t('feedback_context_hint', lang)}
              </span>
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || sending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--mp-cta-blue)] text-white rounded-lg text-xs font-medium
                           disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--mp-cta-blue)]/90 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
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
      {!open && (
        <button
          onClick={openFeedback}
          className={`fixed ${isMobile ? `${mobileOffset} right-4 w-[52px] h-[52px]` : 'bottom-6 right-6 w-11 h-11'} z-40 rounded-full bg-[var(--mp-cta-blue)] text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center active:scale-95`}
          title={t('feedback_button_title', lang)}
          aria-label={t('feedback_button_title', lang)}
        >
          <MessageSquarePlus className="w-5 h-5" />
        </button>
      )}
      {feedbackPanel}
    </>
  )
}
