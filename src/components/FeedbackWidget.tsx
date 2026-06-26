'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, X, Send, Check, MessageCircle, Plus } from 'lucide-react'
import { getStoredSession } from '@/lib/auth'
import { getStoredExamSource } from '@/lib/topics'
import { authFetch as fetch } from '@/lib/authFetch'
import { t, useLang } from '@/lib/i18n'

/**
 * FloatingLauncher (exported as FeedbackWidget for call-site stability).
 *
 * ONE bottom-right launcher, consolidated 2026-06-26. Previously two
 * separate floating buttons (this FeedbackWidget + the Intercom Messenger
 * launcher) stacked and fought the mobile bottom-nav.
 *
 *   - MOBILE (< 768px): a SINGLE FAB at bottom:96px (clear of the ~80px
 *     bottom-nav + the raised center Quiz button), z-40. Tapping it fans up
 *     two actions — "Chat" (opens the Intercom Messenger via Intercom('show'))
 *     and "Feedback" (opens the first-party feedback panel). Intercom's own
 *     launcher is hidden on mobile (IntercomMessenger toggles
 *     hide_default_launcher by viewport), so there is exactly one button.
 *   - DESKTOP (>= 768px): the feedback button renders standalone (bottom-right),
 *     and Intercom shows its own launcher beside it — two distinct affordances.
 *
 * Hidden on /landing, /login, /admin, /privacy, /terms, /impressum (unchanged).
 */

const MOBILE_MQ = '(max-width: 767px)'

function openIntercom() {
  try {
    ;(window as unknown as { Intercom?: (cmd: string) => void }).Intercom?.('show')
  } catch {
    /* Messenger not booted (app_id unset) — no-op */
  }
}

export default function FeedbackWidget() {
  const lang = useLang()
  const [open, setOpen] = useState(false) // feedback panel open
  const [fanOpen, setFanOpen] = useState(false) // mobile action fan open
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  // Reactive pathname — fires on every App Router navigation so the widget
  // hides/shows correctly after navigation (Frontend P1-3, 2026-04-15).
  const pathname = usePathname()

  useEffect(() => { setMounted(true) }, [])

  // Track viewport so the launcher knows whether to fan (mobile) or render
  // the standalone feedback button (desktop, Intercom shows its own launcher).
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

  // Close the fan on navigation so it never lingers across routes.
  useEffect(() => { setFanOpen(false) }, [pathname])

  if (!mounted) return null

  // Hide on certain pages
  if (['/landing', '/login', '/admin', '/privacy', '/terms', '/impressum'].some(p => pathname?.startsWith(p))) {
    return null
  }

  const handleSubmit = async () => {
    if (!message.trim() || sending) return
    setSending(true)
    try {
      const session = getStoredSession()
      const userId = session?.user?.id || null

      // Auto-capture context
      const context = {
        url: window.location.href,
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

      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), context, userId }),
      })

      setSent(true)
      setMessage('')
      setTimeout(() => {
        setSent(false)
        setOpen(false)
      }, 2000)
    } catch {
      // Silently fail — don't disrupt the user
    } finally {
      setSending(false)
    }
  }

  const openFeedback = () => {
    setFanOpen(false)
    setOpen(true)
  }

  // The feedback panel.
  //   - Mobile: bottom:96px (clears the bottom-nav), shared with the launcher.
  //   - Desktop: bottom:96px so the panel opens ABOVE Intercom's own launcher
  //     (~60px tall at bottom:20px) instead of overlapping it. Was md:bottom-6
  //     (24px) which collided with — and hid behind — the Intercom bubble.
  const feedbackPanel = open && (
    <div className="fixed bottom-24 right-4 md:right-6 z-50 w-80 max-w-[calc(100vw-2rem)]">
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
              onChange={e => setMessage(e.target.value)}
              placeholder={t('feedback_placeholder', lang)}
              aria-label={t('feedback_textarea_aria', lang)}
              className="w-full h-24 text-sm bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] border border-[var(--mp-border-subtle)] rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[var(--mp-cta-blue)]/50"
              maxLength={2000}
            />
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

  // ─── DESKTOP: standalone feedback button, STACKED ABOVE Intercom's launcher ──
  // Intercom shows its own default launcher bottom-right (~60px tall, sitting at
  // bottom:20px via vertical_padding:20). Placing the feedback button at
  // bottom:96px (bottom-24) puts it cleanly ABOVE that launcher in the same
  // right column, so the two are separate + both visible (neither occludes the
  // other). Previously bottom-6 (24px) sat INSIDE Intercom's footprint and was
  // hidden behind the chat bubble — the bug flagged in FEEDBACK-LOG #1.
  if (!isMobile) {
    return (
      <>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="fixed bottom-24 right-6 z-50
                       w-11 h-11 rounded-full bg-[var(--mp-cta-blue)] text-white shadow-lg
                       hover:bg-[var(--mp-cta-blue)]/90 hover:shadow-xl transition-all
                       flex items-center justify-center active:scale-95"
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

  // ─── MOBILE: ONE launcher at bottom:96px that fans up Chat + Feedback ───
  return (
    <>
      {!open && (
        <div className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-3">
          {/* Fanned actions — appear above the launcher when open */}
          {fanOpen && (
            <>
              <button
                onClick={() => { setFanOpen(false); openIntercom() }}
                className="flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-full
                           bg-[var(--mp-surface-raised)] text-[var(--mp-fg)] shadow-lg
                           border border-[var(--mp-border-subtle)] active:scale-95 transition-all
                           animate-[fade-in_180ms_var(--mp-ease-out)]"
                aria-label={t('launcher_chat', lang)}
              >
                <span className="text-xs font-medium">{t('launcher_chat', lang)}</span>
                <span className="w-8 h-8 -mr-1 rounded-full bg-[var(--mp-accent-teal)] text-white flex items-center justify-center">
                  <MessageCircle className="w-4 h-4" />
                </span>
              </button>
              <button
                onClick={openFeedback}
                className="flex items-center gap-2 pl-3 pr-3.5 py-2 rounded-full
                           bg-[var(--mp-surface-raised)] text-[var(--mp-fg)] shadow-lg
                           border border-[var(--mp-border-subtle)] active:scale-95 transition-all
                           animate-[fade-in_180ms_var(--mp-ease-out)]"
                aria-label={t('launcher_feedback', lang)}
              >
                <span className="text-xs font-medium">{t('launcher_feedback', lang)}</span>
                <span className="w-8 h-8 -mr-1 rounded-full bg-[var(--mp-cta-blue)] text-white flex items-center justify-center">
                  <MessageSquarePlus className="w-4 h-4" />
                </span>
              </button>
            </>
          )}

          {/* The single launcher button */}
          <button
            onClick={() => setFanOpen(v => !v)}
            className="w-[52px] h-[52px] rounded-full bg-[var(--mp-cta-blue)] text-white shadow-lg
                       hover:shadow-xl transition-all flex items-center justify-center active:scale-95"
            title={fanOpen ? t('launcher_close', lang) : t('launcher_open', lang)}
            aria-label={fanOpen ? t('launcher_close', lang) : t('launcher_open', lang)}
            aria-expanded={fanOpen}
          >
            {fanOpen
              ? <Plus className="w-6 h-6 rotate-45 transition-transform" />
              : <MessageCircle className="w-5 h-5" />}
          </button>
        </div>
      )}
      {feedbackPanel}
    </>
  )
}
