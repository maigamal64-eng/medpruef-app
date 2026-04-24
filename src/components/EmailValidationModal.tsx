'use client'

import { useEffect, useState } from 'react'
import { Mail, CheckCircle } from 'lucide-react'
import { getStoredSession, storeSession } from '@/lib/auth'
import { authFetch } from '@/lib/authFetch'
import { Dialog, TextField, Alert } from '@/components/ui'
import { t, useLang } from '@/lib/i18n'

const STORAGE_KEY = 'medpruef_email_validation_dismissed'

/**
 * Shown to users whose email has bounced (email_status === 'bounced').
 * Asks them to update their email address.
 * Uses sessionStorage so it re-shows on next session if not resolved.
 */
export default function EmailValidationModal() {
  const lang = useLang()
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
      setError(t('email_validation_invalid', lang))
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
          setError(t('email_validation_duplicate', lang))
        } else {
          setError(data.error || t('email_validation_generic_error', lang))
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
      setError(t('email_validation_network', lang))
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
        {t('email_validation_remind_later', lang)}
      </button>
      <button
        type="submit"
        form="email-validation-form"
        disabled={!newEmail.trim() || submitting}
        className="mp-btn mp-btn--destructive"
      >
        {submitting ? t('email_validation_submitting', lang) : t('email_validation_submit', lang)}
      </button>
    </>
  )

  const errorBody = t('email_validation_error_body', lang).split('{email}')

  return (
    <Dialog
      open={show}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
      title={t('email_validation_title', lang)}
      description={success ? undefined : t('email_validation_subtitle', lang)}
      maxWidth="480px"
      footer={footer}
    >
      {success ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <CheckCircle className="w-12 h-12 text-[var(--mp-viridian)]" aria-hidden />
          <p className="text-sm font-medium text-[var(--mp-fg)] text-center">
            {t('email_validation_success', lang)}
          </p>
        </div>
      ) : (
        <form id="email-validation-form" onSubmit={handleSubmit} className="space-y-4">
          <Alert variant="error" title={t('email_validation_error_title', lang)}>
            <span className="flex items-start gap-2">
              <Mail className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>
                {errorBody[0]}<strong>{currentEmail}</strong>{errorBody[1] ?? ''}
              </span>
            </span>
          </Alert>

          {error && (
            <Alert variant="error" title={t('email_validation_update_fail_title', lang)}>
              {error}
            </Alert>
          )}

          <TextField
            label={t('email_validation_new_label', lang)}
            type="email"
            required
            value={newEmail}
            onChange={(e) => { setNewEmail(e.target.value); setError('') }}
            placeholder={t('email_validation_placeholder', lang)}
            autoFocus
          />
        </form>
      )}
    </Dialog>
  )
}
