'use client'

import { useState, useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { MessageSquarePlus, X, Send, Check } from 'lucide-react'
import { getStoredSession } from '@/lib/auth'
import { getStoredExamSource } from '@/lib/topics'
import { authFetch as fetch } from '@/lib/authFetch'

/**
 * Global floating feedback button — visible on every page.
 * Click opens a small non-disruptive panel that auto-captures context
 * (URL, user, exam, question if on quiz/exam page) and submits to
 * /api/feedback. User can continue their session undisturbed.
 *
 * Hidden on /landing, /login, /admin pages.
 */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const [mounted, setMounted] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  // Reactive pathname — previously this read window.location.pathname
  // inside render, which only re-evaluated when a parent re-rendered
  // for unrelated reasons. After navigation from /quiz → /admin the
  // widget would stay visible. usePathname from next/navigation fires
  // on every App Router navigation. Fixed 2026-04-15 (Frontend P1-3).
  const pathname = usePathname()

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (open && textRef.current) textRef.current.focus()
  }, [open])

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

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50
                     w-11 h-11 rounded-full bg-[#003A8C] text-white shadow-lg
                     hover:bg-[#003A8C]/90 hover:shadow-xl transition-all
                     flex items-center justify-center
                     active:scale-95"
          title="Feedback / Problem melden"
        >
          <MessageSquarePlus className="w-5 h-5" />
        </button>
      )}

      {/* Feedback panel */}
      {open && (
        <div className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 w-80 max-w-[calc(100vw-2rem)]">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#003A8C] text-white">
              <span className="text-sm font-semibold">Feedback / Problem melden</span>
              <button onClick={() => setOpen(false)} className="hover:bg-white/20 rounded p-1 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {sent ? (
              <div className="p-6 text-center">
                <Check className="w-8 h-8 text-[#00A896] mx-auto mb-2" />
                <p className="text-sm font-medium text-[#1A2B3C] dark:text-white">Danke! / Thank you!</p>
                <p className="text-xs text-[#A0AEC0] mt-1">Wir schauen uns das an.</p>
              </div>
            ) : (
              <div className="p-4">
                <textarea
                  ref={textRef}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Was ist Ihnen aufgefallen? / What did you notice?"
                  className="w-full h-24 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-[#003A8C]/50"
                  maxLength={2000}
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-[#A0AEC0]">
                    Seite & Kontext werden automatisch erfasst
                  </span>
                  <button
                    onClick={handleSubmit}
                    disabled={!message.trim() || sending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#003A8C] text-white rounded-lg text-xs font-medium
                               disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#003A8C]/90 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sending ? '...' : 'Senden'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
