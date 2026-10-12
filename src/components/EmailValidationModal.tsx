'use client'

import { useEffect, useRef, useState } from 'react'
import { Mail, CheckCircle } from 'lucide-react'
import { getStoredSession, storeSession } from '@/lib/auth'
import { authFetch } from '@/lib/authFetch'
import { Dialog, TextField } from '@/components/ui'
import { t, useLang } from '@/lib/i18n'
import { dismissSurface, useAnnouncementSlot } from '@/lib/announcements/queue'

/**
 * Bounced address repair (UX-ONB-37). An info card on Home, granted by the
 * announcement queue as its single inline card, never a modal over a
 * question. "E-Mail-Adresse ändern" opens a short form in the Dialog
 * primitive; server errors stay on the field with the typed address kept;
 * success says only what happened ("Gespeichert.") because no confirmation
 * mail is sent by this route. "Später erinnern" snoozes for 7 days.
 * Scope stays bounced addresses.
 */
export default function EmailValidationModal() {
  const lang = useLang()
  const [eligible, setEligible] = useState(false)
  const [currentEmail, setCurrentEmail] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)

  useEffect(() => {
    try {
      const session = getStoredSession()
      const userId = session?.user?.id || ''
      if (!userId || userId.startsWith('guest_')) return
      if (session?.user?.email_status !== 'bounced') return
      setCurrentEmail(session?.user?.email || '')
      setEligible(true)
    } catch { /* silent */ }
  }, [])

  const visible = useAnnouncementSlot('email_validation', eligible && !success)

  const later = () => {
    setEligible(false)
    dismissSurface('email_validation', 'later')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy.current) return
    const trimmed = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t('email_validation_invalid', lang))
      return
    }
    busy.current = true
    setSubmitting(true)
    setError('')
    try {
      const res = await authFetch('/api/user/email-update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
        timeoutMs: 15_000,
      })
      if (!res.ok) {
        setError(t(res.status === 409 ? 'email_validation_duplicate' : 'email_validation_generic_error', lang))
        return
      }
      const session = getStoredSession()
      if (session) {
        session.user.email = trimmed
        session.user.email_status = 'unverified'
        storeSession(session)
      }
      setSuccess(true)
    } catch {
      setError(t('email_validation_network', lang))
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  const body = t('email_validation_error_body', lang).split('{email}')

  return (
    <>
      {(visible || success) && (
        <section
          aria-labelledby="email-repair-title"
          className="mb-6 rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-4"
          data-testid="email-repair-card"
        >
          {success ? (
            <div role="status" className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 id="email-repair-title" className="text-[15px] font-semibold text-[var(--mp-fg)]">{t('a22_email_saved', lang)}</h2>
                <button type="button" onClick={() => { setSuccess(false); setEligible(false) }} className="mt-2 mp-btn mp-btn--secondary min-h-11">{t('a22_close', lang)}</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 flex-shrink-0 text-[var(--mp-cta-blue)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 id="email-repair-title" className="text-[15px] font-semibold text-[var(--mp-fg)]">{t('a22_email_repair_title', lang)}</h2>
                <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">{body[0]}<strong className="break-all">{currentEmail}</strong>{body[1] ?? ''}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setFormOpen(true)} className="mp-btn mp-btn--primary min-h-11">{t('a22_email_repair_title', lang)}</button>
                  <button type="button" onClick={later} className="mp-btn mp-btn--secondary min-h-11">{t('email_validation_remind_later', lang)}</button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <Dialog
        open={formOpen && !success}
        onOpenChange={setFormOpen}
        title={t('a22_email_repair_title', lang)}
        kind="form"
        busy={submitting}
        maxWidth="480px"
        footer={
          <>
            <button type="button" onClick={() => setFormOpen(false)} className="mp-btn mp-btn--secondary min-h-11">{t('a12_cancel', lang)}</button>
            <button type="submit" form="email-repair-form" aria-busy={submitting} aria-disabled={submitting} className="mp-btn mp-btn--primary min-h-11">
              {submitting ? t('email_validation_submitting', lang) : t('a22_email_repair_save', lang)}
            </button>
          </>
        }
      >
        <form id="email-repair-form" onSubmit={handleSubmit} noValidate className="space-y-4">
          <TextField
            label={t('email_validation_new_label', lang)}
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={newEmail}
            error={error || undefined}
            onChange={(e) => { setNewEmail(e.target.value); setError('') }}
          />
        </form>
      </Dialog>
    </>
  )
}
