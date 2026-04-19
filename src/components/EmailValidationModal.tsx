'use client'

import { useEffect, useState } from 'react'
import { Mail, CheckCircle } from 'lucide-react'
import { getStoredSession, storeSession } from '@/lib/auth'
import { authFetch } from '@/lib/authFetch'
import { Dialog, TextField, Alert } from '@/components/ui'

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

  const footer = success ? null : (
    <>
      <button
        type="button"
        onClick={dismiss}
        className="mp-btn mp-btn--secondary"
      >
        Später erinnern
      </button>
      <button
        type="submit"
        form="email-validation-form"
        disabled={!newEmail.trim() || submitting}
        className="mp-btn mp-btn--destructive"
      >
        {submitting ? 'Wird aktualisiert…' : 'E-Mail aktualisieren'}
      </button>
    </>
  )

  return (
    <Dialog
      open={show}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
      title="E-Mail-Adresse prüfen"
      description={success ? undefined : 'Deine E-Mail-Adresse scheint nicht zu funktionieren.'}
      maxWidth="480px"
      footer={footer}
    >
      {success ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <CheckCircle className="w-12 h-12 text-[var(--mp-viridian)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--mp-fg)] text-center">
            E-Mail-Adresse aktualisiert!
          </p>
        </div>
      ) : (
        <form id="email-validation-form" onSubmit={handleSubmit} className="space-y-4">
          <Alert variant="error" title="Zustellung fehlgeschlagen">
            <span className="flex items-start gap-2">
              <Mail className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>
                Nachrichten an <strong>{currentEmail}</strong> konnten nicht zugestellt
                werden. Bitte überprüfe die Adresse oder hinterlege eine neue, damit du
                wichtige Updates erhältst.
              </span>
            </span>
          </Alert>

          {error && (
            <Alert variant="error" title="Aktualisierung nicht möglich">
              {error}
            </Alert>
          )}

          <TextField
            label="Neue E-Mail-Adresse"
            type="email"
            required
            value={newEmail}
            onChange={(e) => { setNewEmail(e.target.value); setError('') }}
            placeholder="user-71248681@example.com"
            autoFocus
          />
        </form>
      )}
    </Dialog>
  )
}
