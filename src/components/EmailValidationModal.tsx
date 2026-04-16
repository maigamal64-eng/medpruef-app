'use client'

import { useEffect, useState } from 'react'
import { X, AlertTriangle, Mail, CheckCircle } from 'lucide-react'
import { getStoredSession, storeSession } from '@/lib/auth'
import { authFetch } from '@/lib/authFetch'

const STORAGE_KEY = 'medpruef_email_validation_dismissed'

/**
 * Shown to users whose email has bounced (email_status === 'bounced').
 * Asks them to update their email address.
 * Uses sessionStorage so it re-shows on next session if not resolved.
 */
export default function EmailValidationModal() {
  const [show, setShow] = useState(false)
  const [currentEmail, setCurrentEmail] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') return

      const session = getStoredSession()
      const userId = session?.user?.id || ''
      if (!userId || userId.startsWith('guest_')) return

      // Only show if email_status is 'bounced'
      if (session?.user?.email_status !== 'bounced') return

      setCurrentEmail(session?.user?.email || '')

      // Delay to avoid fighting other modals (WhatsNew, Survey)
      const timer = setTimeout(() => setShow(true), 4000)
      return () => clearTimeout(timer)
    } catch { /* silent */ }
  }, [])

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    sessionStorage.setItem(STORAGE_KEY, '1')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed || submitting) return

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Bitte gib eine gültige E-Mail-Adresse ein.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await authFetch('/api/user/email-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          setError('Diese E-Mail-Adresse wird bereits verwendet.')
        } else {
          setError(data.error || 'Aktualisierung fehlgeschlagen.')
        }
        return
      }

      // Update session with new email
      const session = getStoredSession()
      if (session) {
        session.user.email = trimmed
        session.user.email_status = 'unverified'
        storeSession(session)
      }

      setSuccess(true)
      setTimeout(() => {
        dismiss()
      }, 2000)
    } catch {
      setError('Verbindungsfehler. Bitte versuche es erneut.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[85] bg-black/50 flex items-center justify-center px-4" onClick={dismiss}>
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#D64545] to-[#F4A261] text-white p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              <h2 className="text-lg font-bold font-display">E-Mail-Adresse prüfen</h2>
            </div>
            <button onClick={dismiss} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle className="w-12 h-12 text-green-500" />
              <p className="text-sm font-medium text-[#1A2B3C] dark:text-white text-center">
                E-Mail-Adresse aktualisiert!
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
                <Mail className="w-5 h-5 text-[#D64545] mt-0.5 shrink-0" />
                <p className="text-sm text-[#4A5568] dark:text-slate-300">
                  Deine E-Mail-Adresse <strong className="text-[#1A2B3C] dark:text-white">{currentEmail}</strong> scheint
                  nicht zu funktionieren. Unsere Nachrichten konnten nicht zugestellt werden.
                </p>
              </div>

              <p className="text-sm text-[#4A5568] dark:text-slate-300">
                Bitte überprüfe deine E-Mail-Adresse oder gib eine neue ein, damit du wichtige Updates und
                Benachrichtigungen erhältst.
              </p>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-[#1A2B3C] dark:text-white mb-1">
                    Neue E-Mail-Adresse
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={e => { setNewEmail(e.target.value); setError('') }}
                    placeholder="user-71248681@example.com"
                    autoFocus
                    className="w-full text-sm bg-[#F7F9FC] dark:bg-slate-700 border border-[#E4E9F0] dark:border-slate-600 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#D64545]/30 focus:border-[#D64545] text-[#1A2B3C] dark:text-white placeholder:text-[#A0AEC0]"
                  />
                </div>

                {error && (
                  <p className="text-xs text-[#D64545] font-medium">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={!newEmail.trim() || submitting}
                  className="w-full py-2.5 bg-[#D64545] text-white rounded-xl font-semibold text-sm hover:bg-[#D64545]/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Wird aktualisiert…' : 'E-Mail aktualisieren'}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-5 py-3 border-t border-[#E4E9F0] dark:border-slate-700">
            <button
              onClick={dismiss}
              className="w-full text-xs text-[#A0AEC0] hover:text-[#4A5568] dark:hover:text-slate-300 transition-colors"
            >
              Später erinnern
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
