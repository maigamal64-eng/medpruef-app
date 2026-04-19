'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, ChevronLeft, Check, Sparkles } from 'lucide-react'
import { getStoredSession } from '@/lib/auth'
import { authFetch as fetch } from '@/lib/authFetch'
import { Dialog, Textarea } from '@/components/ui'

const STORAGE_COMPLETED = 'medpruef_survey_v1_completed'
const STORAGE_DISMISSED = 'medpruef_survey_v1_dismissed'

/* ── Rating labels (emoji + text) ── */
const RATING_LABELS = [
  { emoji: '😞', label: 'Schlecht' },
  { emoji: '😕', label: 'Geht so' },
  { emoji: '😐', label: 'OK' },
  { emoji: '🙂', label: 'Gut' },
  { emoji: '🤩', label: 'Super' },
]

/* ── Step 1 questions ── */
const RATING_QUESTIONS = [
  'Wie bewertest du die Qualität der Fragen?',
  'Wie einfach ist die App zu benutzen?',
  'Wie hilfreich sind die KI-Erklärungen?',
  'Wie zufrieden bist du mit der Prüfungsvorbereitung insgesamt?',
  'Wie wahrscheinlich empfiehlst du MedPrüf weiter?',
]

/* ── Step 2 options ── */
const BEST_FEATURES = [
  'Große Fragenbank',
  'Spaced Repetition',
  'KI-Erklärungen',
  'Prüfungssimulation',
  'Fortschritts-Tracking',
  'Mobile App (PWA)',
]
const IMPROVE_OPTIONS = [
  'Mehr Fragen',
  'Bessere Erklärungen',
  'Lernplan-Funktion',
  'Gruppenlernen',
  'Offline-Modus',
  'Preisgestaltung',
]

export default function UserSurveyModal() {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(1) // 1, 2, 3, or 4 (success)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [firstName, setFirstName] = useState('')

  // Step 1: ratings (1-5, 0 = unrated)
  const [ratings, setRatings] = useState<number[]>([0, 0, 0, 0, 0])

  // Step 2: multi-select
  const [bestFeatures, setBestFeatures] = useState<string[]>([])
  const [bestOther, setBestOther] = useState('')
  const [improvements, setImprovements] = useState<string[]>([])
  const [improveOther, setImproveOther] = useState('')

  // Step 3: open text
  const [openText, setOpenText] = useState('')

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    try {
      // Already completed or not logged in
      if (localStorage.getItem(STORAGE_COMPLETED) === 'true') return

      const session = getStoredSession()
      const userId = session?.user?.id || ''
      if (!userId || userId.startsWith('guest_')) return

      // Must have completed onboarding
      const onboarding = JSON.parse(localStorage.getItem('medpruef_onboarding') || '{}')
      if (!onboarding?.completedAt) return

      setFirstName(session?.user?.first_name || '')

      // Delay so it doesn't fight with WhatsNewModal or page load
      const timer = setTimeout(() => setShow(true), 3000)
      return () => clearTimeout(timer)
    } catch { /* silent */ }
  }, [])

  const dismiss = () => {
    setShow(false)
    localStorage.setItem(STORAGE_DISMISSED, 'true')
  }

  const goStep = (target: number) => {
    setDirection(target > step ? 'forward' : 'back')
    setStep(target)
  }

  const setRating = (qIndex: number, value: number) => {
    setRatings(prev => {
      const next = [...prev]
      next[qIndex] = value
      return next
    })
  }

  const toggleCheckbox = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    value: string
  ) => {
    setList(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)

    try {
      const surveyPayload = {
        type: 'survey_v1',
        ratings: {
          question_quality: ratings[0],
          ease_of_use: ratings[1],
          ai_explanations: ratings[2],
          overall_satisfaction: ratings[3],
          nps: ratings[4],
        },
        best_features: [
          ...bestFeatures,
          ...(bestOther.trim() ? [`Andere: ${bestOther.trim()}`] : []),
        ],
        improvements: [
          ...improvements,
          ...(improveOther.trim() ? [`Andere: ${improveOther.trim()}`] : []),
        ],
        open_text: openText.trim() || null,
        submitted_at: new Date().toISOString(),
      }

      // Build a readable summary as the "message" field (the feedback API requires it)
      const ratingNames = [
        'Fragenqualität',
        'Bedienbarkeit',
        'KI-Erklärungen',
        'Gesamtzufriedenheit',
        'Weiterempfehlung (NPS)',
      ]
      const ratingsSummary = ratings
        .map((r, i) => `${ratingNames[i]}: ${r}/5`)
        .join(', ')

      const message = [
        `[Survey v1] ${ratingsSummary}`,
        surveyPayload.best_features.length
          ? `Am besten: ${surveyPayload.best_features.join(', ')}`
          : null,
        surveyPayload.improvements.length
          ? `Verbessern: ${surveyPayload.improvements.join(', ')}`
          : null,
        surveyPayload.open_text
          ? `Kommentar: ${surveyPayload.open_text}`
          : null,
      ]
        .filter(Boolean)
        .join(' | ')

      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          context: surveyPayload,
        }),
      })

      localStorage.setItem(STORAGE_COMPLETED, 'true')
      goStep(4) // success screen

      // Auto-close after 3 seconds
      setTimeout(() => setShow(false), 3000)
    } catch {
      // Silent fail — don't disrupt the user
      setShow(false)
    } finally {
      setSubmitting(false)
    }
  }

  const step1Complete = ratings.every(r => r > 0)

  const title = step === 4 ? 'Danke!' : 'Dein Feedback'
  const description = step < 4 ? `Schritt ${step} von 3` : undefined

  let footer: React.ReactNode = null
  if (step < 4) {
    footer = (
      <div className="flex items-center justify-between w-full">
        <div>
          {step === 1 ? (
            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors"
            >
              Später
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goStep(step - 1)}
              className="mp-btn mp-btn--secondary"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
              Zurück
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {step < 3 ? (
            <button
              type="button"
              onClick={() => goStep(step + 1)}
              disabled={step === 1 && !step1Complete}
              className="mp-btn mp-btn--primary"
            >
              Weiter
              <ChevronRight className="w-4 h-4" aria-hidden />
            </button>
          ) : (
            <>
              {!openText.trim() && (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="text-xs text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors disabled:opacity-40"
                >
                  Überspringen
                </button>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="mp-btn mp-btn--success"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Senden...
                  </span>
                ) : (
                  <>
                    Absenden
                    <Check className="w-4 h-4" aria-hidden />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <Dialog
      open={show}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
      title={title}
      description={description}
      maxWidth="560px"
      footer={footer}
    >
      {/* Progress bar */}
      {step < 4 && (
        <div className="mb-4">
          <div className="flex items-center gap-1 mb-1">
            <Sparkles className="w-4 h-4 text-[var(--mp-warning)]" aria-hidden />
            <span className="text-[11px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold">
              Umfrage
            </span>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className={`h-1.5 rounded-full flex-1 transition-all duration-300 ${
                  s < step
                    ? 'bg-[var(--mp-viridian)]'
                    : s === step
                      ? 'bg-[var(--mp-cta-blue)]'
                      : 'bg-[var(--mp-border)]'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* ═══ STEP 1: Ratings ═══ */}
      {step === 1 && (
        <div
          key="step1"
          className={`space-y-5 ${
            direction === 'forward'
              ? 'animate-[survey-slide-left_0.25s_ease-out]'
              : 'animate-[survey-slide-right_0.25s_ease-out]'
          }`}
        >
          <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">
            Danke{firstName ? `, ${firstName}` : ''}! Dein Feedback hilft uns,
            MedPrüf besser zu machen.
          </p>

          {RATING_QUESTIONS.map((q, qi) => (
            <div key={qi}>
              <p className="text-sm font-medium text-[var(--mp-fg)] mb-2">
                {q}
              </p>
              <div className="flex gap-2">
                {RATING_LABELS.map((rl, ri) => {
                  const value = ri + 1
                  const selected = ratings[qi] === value
                  return (
                    <button
                      key={ri}
                      type="button"
                      onClick={() => setRating(qi, value)}
                      className={`
                        flex-1 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl
                        transition-all duration-150 min-h-[60px] min-w-[48px]
                        ${
                          selected
                            ? 'bg-[var(--mp-cta-blue)]/10 ring-2 ring-[var(--mp-cta-blue)] scale-105'
                            : 'bg-[var(--mp-surface-sunken)] hover:bg-[var(--mp-border)]'
                        }
                      `}
                      aria-label={`${rl.label} (${value}/5)`}
                    >
                      <span className="text-xl leading-none">{rl.emoji}</span>
                      <span
                        className={`text-[10px] leading-tight ${
                          selected
                            ? 'text-[var(--mp-cta-blue)] font-semibold'
                            : 'text-[var(--mp-fg-subtle)]'
                        }`}
                      >
                        {rl.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ STEP 2: Multi-select ═══ */}
      {step === 2 && (
        <div
          key="step2"
          className={`space-y-6 ${
            direction === 'forward'
              ? 'animate-[survey-slide-left_0.25s_ease-out]'
              : 'animate-[survey-slide-right_0.25s_ease-out]'
          }`}
        >
          {/* Best features */}
          <div>
            <p className="text-sm font-medium text-[var(--mp-fg)] mb-3">
              Was findest du am besten an MedPrüf?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {BEST_FEATURES.map(feat => {
                const checked = bestFeatures.includes(feat)
                return (
                  <button
                    key={feat}
                    type="button"
                    onClick={() => toggleCheckbox(bestFeatures, setBestFeatures, feat)}
                    className={`
                      text-left text-sm px-3 py-2.5 rounded-xl transition-all duration-150
                      ${
                        checked
                          ? 'bg-[var(--mp-viridian)]/10 ring-1 ring-[var(--mp-viridian)] text-[var(--mp-viridian)] font-medium'
                          : 'bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] hover:bg-[var(--mp-border)]'
                      }
                    `}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          checked
                            ? 'bg-[var(--mp-viridian)] border-[var(--mp-viridian)]'
                            : 'border-[var(--mp-border)]'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-white" aria-hidden />}
                      </span>
                      {feat}
                    </span>
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              placeholder="Andere..."
              value={bestOther}
              onChange={e => setBestOther(e.target.value)}
              maxLength={200}
              className="mt-2 w-full text-sm bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--mp-viridian)]/50 text-[var(--mp-fg)] placeholder:text-[var(--mp-fg-subtle)]"
              aria-label="Andere Funktionen"
            />
          </div>

          {/* Improvements */}
          <div>
            <p className="text-sm font-medium text-[var(--mp-fg)] mb-3">
              Was sollten wir als Nächstes verbessern?
            </p>
            <div className="grid grid-cols-2 gap-2">
              {IMPROVE_OPTIONS.map(opt => {
                const checked = improvements.includes(opt)
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleCheckbox(improvements, setImprovements, opt)}
                    className={`
                      text-left text-sm px-3 py-2.5 rounded-xl transition-all duration-150
                      ${
                        checked
                          ? 'bg-[var(--mp-warning)]/10 ring-1 ring-[var(--mp-warning)] text-[var(--mp-warning-dk)] font-medium'
                          : 'bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] hover:bg-[var(--mp-border)]'
                      }
                    `}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          checked
                            ? 'bg-[var(--mp-warning)] border-[var(--mp-warning)]'
                            : 'border-[var(--mp-border)]'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-white" aria-hidden />}
                      </span>
                      {opt}
                    </span>
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              placeholder="Andere..."
              value={improveOther}
              onChange={e => setImproveOther(e.target.value)}
              maxLength={200}
              className="mt-2 w-full text-sm bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--mp-warning)]/50 text-[var(--mp-fg)] placeholder:text-[var(--mp-fg-subtle)]"
              aria-label="Andere Verbesserungen"
            />
          </div>
        </div>
      )}

      {/* ═══ STEP 3: Open text ═══ */}
      {step === 3 && (
        <div
          key="step3"
          className={`space-y-4 ${
            direction === 'forward'
              ? 'animate-[survey-slide-left_0.25s_ease-out]'
              : 'animate-[survey-slide-right_0.25s_ease-out]'
          }`}
        >
          <p className="text-sm font-medium text-[var(--mp-fg)]">
            Möchtest du noch etwas hinzufügen?
          </p>
          <Textarea
            label="Dein Kommentar"
            hideLabel
            helper="Optional — alles was dir einfällt hilft uns weiter."
            value={openText}
            onChange={e => setOpenText(e.target.value)}
            placeholder="Dein Kommentar..."
            maxLength={2000}
            rows={6}
          />
        </div>
      )}

      {/* ═══ STEP 4: Success ═══ */}
      {step === 4 && (
        <div className="py-4 text-center animate-scale-in">
          <div className="relative inline-block mb-4">
            <span className="text-5xl">🎉</span>
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{
                  backgroundColor: ['#007B5F', '#D68A3A', '#003A8C', '#00A896', '#D64545'][i % 5],
                  top: '50%',
                  left: '50%',
                  animation: `confetti-burst 0.8s ease-out ${i * 0.04}s forwards`,
                  opacity: 0,
                  transform: `rotate(${i * 30}deg) translateY(0)`,
                }}
              />
            ))}
          </div>
          <p className="text-sm text-[var(--mp-fg-subtle)]">
            Dein Feedback macht MedPrüf besser.
          </p>
        </div>
      )}

      {/* Keyframe animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes confetti-burst {
          0% { opacity: 1; transform: rotate(var(--r, 0deg)) translateY(0) scale(1); }
          100% { opacity: 0; transform: rotate(var(--r, 0deg)) translateY(-60px) scale(0.5); }
        }
        @keyframes survey-slide-left {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes survey-slide-right {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
      ` }} />
    </Dialog>
  )
}
