'use client'

import { useEffect, useState, useRef } from 'react'
import { X, ChevronRight, ChevronLeft, Check, Sparkles } from 'lucide-react'
import { getStoredSession } from '@/lib/auth'
import { authFetch as fetch } from '@/lib/authFetch'

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
  const modalRef = useRef<HTMLDivElement>(null)

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

  if (!show) return null

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

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={dismiss}
    >
      <div
        ref={modalRef}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden animate-scale-in flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        {step < 4 && (
          <div className="sticky top-0 bg-gradient-to-r from-[#001B3D] to-[#003A8C] text-white px-5 py-4 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#F4A261]" />
                <h2 className="text-base font-bold">Dein Feedback</h2>
              </div>
              <button
                onClick={dismiss}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                aria-label="Schließen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Progress dots */}
            <div className="flex items-center gap-2 mt-3">
              {[1, 2, 3].map(s => (
                <div key={s} className="flex-1 flex items-center gap-1">
                  <div
                    className={`h-1.5 rounded-full flex-1 transition-all duration-300 ${
                      s < step
                        ? 'bg-[#00A896]'
                        : s === step
                          ? 'bg-white'
                          : 'bg-white/25'
                    }`}
                  />
                </div>
              ))}
            </div>
            <p className="text-white/50 text-[11px] mt-1.5">
              Schritt {step} von 3
            </p>
          </div>
        )}

        {/* ── Body — scrollable ── */}
        <div className="overflow-y-auto flex-1 overscroll-contain">
          {/* ═══ STEP 1: Ratings ═══ */}
          {step === 1 && (
            <div
              key="step1"
              className={`p-5 space-y-5 ${
                direction === 'forward'
                  ? 'animate-[survey-slide-left_0.25s_ease-out]'
                  : 'animate-[survey-slide-right_0.25s_ease-out]'
              }`}
            >
              <p className="text-sm text-[#4A5568] dark:text-slate-300 leading-relaxed">
                Danke{firstName ? `, ${firstName}` : ''}! Dein Feedback hilft uns,
                MedPrüf besser zu machen.
              </p>

              {RATING_QUESTIONS.map((q, qi) => (
                <div key={qi}>
                  <p className="text-sm font-medium text-[#1A2B3C] dark:text-white mb-2">
                    {q}
                  </p>
                  <div className="flex gap-2">
                    {RATING_LABELS.map((rl, ri) => {
                      const value = ri + 1
                      const selected = ratings[qi] === value
                      return (
                        <button
                          key={ri}
                          onClick={() => setRating(qi, value)}
                          className={`
                            flex-1 flex flex-col items-center gap-1 py-2.5 px-1 rounded-xl
                            transition-all duration-150 min-h-[60px] min-w-[48px]
                            ${
                              selected
                                ? 'bg-[#003A8C]/10 dark:bg-[#003A8C]/30 ring-2 ring-[#003A8C] scale-105'
                                : 'bg-[#F7F9FC] dark:bg-slate-700 hover:bg-[#E4E9F0] dark:hover:bg-slate-600'
                            }
                          `}
                          aria-label={`${rl.label} (${value}/5)`}
                        >
                          <span className="text-xl leading-none">{rl.emoji}</span>
                          <span
                            className={`text-[10px] leading-tight ${
                              selected
                                ? 'text-[#003A8C] dark:text-blue-300 font-semibold'
                                : 'text-[#A0AEC0]'
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
              className={`p-5 space-y-6 ${
                direction === 'forward'
                  ? 'animate-[survey-slide-left_0.25s_ease-out]'
                  : 'animate-[survey-slide-right_0.25s_ease-out]'
              }`}
            >
              {/* Best features */}
              <div>
                <p className="text-sm font-medium text-[#1A2B3C] dark:text-white mb-3">
                  Was findest du am besten an MedPrüf?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {BEST_FEATURES.map(feat => {
                    const checked = bestFeatures.includes(feat)
                    return (
                      <button
                        key={feat}
                        onClick={() => toggleCheckbox(bestFeatures, setBestFeatures, feat)}
                        className={`
                          text-left text-sm px-3 py-2.5 rounded-xl transition-all duration-150
                          ${
                            checked
                              ? 'bg-[#007B5F]/10 dark:bg-[#007B5F]/30 ring-1 ring-[#007B5F] text-[#007B5F] dark:text-emerald-300 font-medium'
                              : 'bg-[#F7F9FC] dark:bg-slate-700 text-[#4A5568] dark:text-slate-300 hover:bg-[#E4E9F0] dark:hover:bg-slate-600'
                          }
                        `}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                              checked
                                ? 'bg-[#007B5F] border-[#007B5F]'
                                : 'border-[#E4E9F0] dark:border-slate-500'
                            }`}
                          >
                            {checked && <Check className="w-3 h-3 text-white" />}
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
                  className="mt-2 w-full text-sm bg-[#F7F9FC] dark:bg-slate-700 border border-[#E4E9F0] dark:border-slate-600 rounded-xl px-3 py-2 focus:outline-none focus:border-[#007B5F]/50 text-[#1A2B3C] dark:text-white placeholder:text-[#A0AEC0]"
                />
              </div>

              {/* Improvements */}
              <div>
                <p className="text-sm font-medium text-[#1A2B3C] dark:text-white mb-3">
                  Was sollten wir als Nächstes verbessern?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {IMPROVE_OPTIONS.map(opt => {
                    const checked = improvements.includes(opt)
                    return (
                      <button
                        key={opt}
                        onClick={() => toggleCheckbox(improvements, setImprovements, opt)}
                        className={`
                          text-left text-sm px-3 py-2.5 rounded-xl transition-all duration-150
                          ${
                            checked
                              ? 'bg-[#F4A261]/10 dark:bg-[#F4A261]/30 ring-1 ring-[#F4A261] text-[#D68B3D] dark:text-amber-300 font-medium'
                              : 'bg-[#F7F9FC] dark:bg-slate-700 text-[#4A5568] dark:text-slate-300 hover:bg-[#E4E9F0] dark:hover:bg-slate-600'
                          }
                        `}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                              checked
                                ? 'bg-[#F4A261] border-[#F4A261]'
                                : 'border-[#E4E9F0] dark:border-slate-500'
                            }`}
                          >
                            {checked && <Check className="w-3 h-3 text-white" />}
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
                  className="mt-2 w-full text-sm bg-[#F7F9FC] dark:bg-slate-700 border border-[#E4E9F0] dark:border-slate-600 rounded-xl px-3 py-2 focus:outline-none focus:border-[#F4A261]/50 text-[#1A2B3C] dark:text-white placeholder:text-[#A0AEC0]"
                />
              </div>
            </div>
          )}

          {/* ═══ STEP 3: Open text ═══ */}
          {step === 3 && (
            <div
              key="step3"
              className={`p-5 space-y-4 ${
                direction === 'forward'
                  ? 'animate-[survey-slide-left_0.25s_ease-out]'
                  : 'animate-[survey-slide-right_0.25s_ease-out]'
              }`}
            >
              <p className="text-sm font-medium text-[#1A2B3C] dark:text-white">
                Möchtest du noch etwas hinzufügen?
              </p>
              <p className="text-xs text-[#A0AEC0]">
                Optional — alles was dir einfällt hilft uns weiter.
              </p>
              <textarea
                value={openText}
                onChange={e => setOpenText(e.target.value)}
                placeholder="Dein Kommentar..."
                maxLength={2000}
                className="w-full h-32 text-sm bg-[#F7F9FC] dark:bg-slate-700 border border-[#E4E9F0] dark:border-slate-600 rounded-xl px-4 py-3 resize-none focus:outline-none focus:border-[#003A8C]/50 text-[#1A2B3C] dark:text-white placeholder:text-[#A0AEC0]"
              />
            </div>
          )}

          {/* ═══ STEP 4: Success ═══ */}
          {step === 4 && (
            <div className="p-8 text-center animate-scale-in">
              <div className="relative inline-block mb-4">
                <span className="text-5xl">🎉</span>
                {/* Confetti dots */}
                {Array.from({ length: 12 }).map((_, i) => (
                  <span
                    key={i}
                    className="absolute w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: ['#007B5F', '#F4A261', '#003A8C', '#00A896', '#D64545'][i % 5],
                      top: '50%',
                      left: '50%',
                      animation: `confetti-burst 0.8s ease-out ${i * 0.04}s forwards`,
                      opacity: 0,
                      transform: `rotate(${i * 30}deg) translateY(0)`,
                    }}
                  />
                ))}
              </div>
              <h3 className="text-xl font-bold text-[#1A2B3C] dark:text-white mb-1 font-display">
                Danke!
              </h3>
              <p className="text-sm text-[#A0AEC0]">
                Dein Feedback macht MedPrüf besser.
              </p>
            </div>
          )}
        </div>

        {/* ── Footer nav ── */}
        {step < 4 && (
          <div className="sticky bottom-0 px-5 py-4 border-t border-[#E4E9F0] dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-between flex-shrink-0">
            <div>
              {step === 1 ? (
                <button
                  onClick={dismiss}
                  className="text-xs text-[#A0AEC0] hover:text-[#4A5568] dark:hover:text-slate-300 transition-colors"
                >
                  Später
                </button>
              ) : (
                <button
                  onClick={() => goStep(step - 1)}
                  className="flex items-center gap-1 text-sm text-[#4A5568] dark:text-slate-300 hover:text-[#1A2B3C] dark:hover:text-white transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Zurück
                </button>
              )}
            </div>

            <div>
              {step < 3 ? (
                <button
                  onClick={() => goStep(step + 1)}
                  disabled={step === 1 && !step1Complete}
                  className="flex items-center gap-1.5 px-5 py-2.5 bg-[#003A8C] text-white rounded-xl text-sm font-semibold hover:bg-[#003A8C]/90 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Weiter
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  {!openText.trim() && (
                    <button
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="text-xs text-[#A0AEC0] hover:text-[#4A5568] dark:hover:text-slate-300 transition-colors disabled:opacity-40"
                    >
                      Überspringen
                    </button>
                  )}
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-[#007B5F] text-white rounded-xl text-sm font-semibold hover:bg-[#007B5F]/90 transition-all active:scale-[0.98] disabled:opacity-60"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Senden...
                      </span>
                    ) : (
                      <>
                        Absenden
                        <Check className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Keyframe animations injected via plain style tag (no styled-jsx) */}
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
    </div>
  )
}
