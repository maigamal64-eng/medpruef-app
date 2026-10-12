'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, ChevronLeft, Check, Sparkles } from 'lucide-react'
import { getStoredSession } from '@/lib/auth'
import { authFetch as fetch } from '@/lib/authFetch'
import { Dialog, Textarea } from '@/components/ui'
import { t, useLang, type TranslationKey } from '@/lib/i18n'
import { fetchAnnouncementState } from '@/lib/announcements/useAnnouncementGate'

const STORAGE_COMPLETED = 'medpruef_survey_v1_completed'
const STORAGE_DISMISSED = 'medpruef_survey_v1_dismissed'

/* ── Rating labels (emoji + translation key) ── */
const RATING_LABELS: { emoji: string; key: TranslationKey }[] = [
  { emoji: '😞', key: 'survey_rating_1' },
  { emoji: '😕', key: 'survey_rating_2' },
  { emoji: '😐', key: 'survey_rating_3' },
  { emoji: '🙂', key: 'survey_rating_4' },
  { emoji: '🤩', key: 'survey_rating_5' },
]

const RATING_QUESTION_KEYS: TranslationKey[] = [
  'survey_q_quality',
  'survey_q_ease',
  'survey_q_ai',
  'survey_q_overall',
  'survey_q_nps',
]

const BEST_FEATURE_KEYS: TranslationKey[] = [
  'survey_best_1',
  'survey_best_2',
  'survey_best_3',
  'survey_best_4',
  'survey_best_5',
  'survey_best_6',
]

const IMPROVE_KEYS: TranslationKey[] = [
  'survey_improve_1',
  'survey_improve_2',
  'survey_improve_3',
  'survey_improve_4',
  'survey_improve_5',
  'survey_improve_6',
]

export default function UserSurveyModal() {
  const lang = useLang()
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(1) // 1, 2, 3, or 4 (success)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [firstName, setFirstName] = useState('')

  // Step 1: ratings (1-5, 0 = unrated)
  const [ratings, setRatings] = useState<number[]>([0, 0, 0, 0, 0])

  // Step 2: multi-select (store the DE key text for backend stability)
  const [bestFeatures, setBestFeatures] = useState<string[]>([])
  const [bestOther, setBestOther] = useState('')
  const [improvements, setImprovements] = useState<string[]>([])
  const [improveOther, setImproveOther] = useState('')

  // Step 3: open text
  const [openText, setOpenText] = useState('')

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    ;(async () => {
      try {
        // Already completed or dismissed locally — no work to do.
        if (localStorage.getItem(STORAGE_COMPLETED) === 'true') return
        if (localStorage.getItem(STORAGE_DISMISSED) === 'true') return

        const session = getStoredSession()
        const userId = session?.user?.id || ''
        if (!userId || userId.startsWith('guest_')) return

        // Must have completed onboarding (legacy localStorage check —
        // the server-side onboarding gate from review-2026-04-26-A2
        // is checked at the route level, not here).
        const onboarding = JSON.parse(localStorage.getItem('medpruef_onboarding') || '{}')
        if (!onboarding?.completedAt) return

        // Server-side cross-device gate (review-2026-04-26-A3): enforce
        // the cadence rule (session_count >= 3 AND qs_answered_total >= 25)
        // AND check if any device has already shown or dismissed the survey.
        // This is the authoritative gate — localStorage checks above are
        // fast-path short-circuits only. Fresh users (session 1, 0 questions)
        // must NEVER see this modal.
        // Shared in-flight-deduped GET (B-09) — collapses onto the one
        // /api/announcements/state request the page already fires
        // instead of adding a 6th. Same authenticated call as before
        // (this modal already used authFetch), same fields read.
        try {
          const body = await fetchAnnouncementState()
          const state = body?.state
          if (state) {
            // Already shown or dismissed cross-device — skip.
            if (state.feedbackSurveyShownAt || state.feedbackSurveyDismissedAt) {
              try { localStorage.setItem(STORAGE_DISMISSED, 'true') } catch {}
              return
            }
            // Cadence gate: require at least 3 sessions AND 25 questions answered.
            // This prevents the survey from ambushing brand-new users.
            const sessions = state.sessionCount ?? 1
            const qs = state.qsAnsweredTotal ?? 0
            if (sessions < 3 || qs < 25) return
          }
        } catch { /* network error — fall through to legacy behaviour */ }

        if (cancelled) return
        setFirstName(session?.user?.first_name || '')
        // Delay so it doesn't fight with WhatsNewModal or page load
        timer = setTimeout(() => {
          if (cancelled) return
          setShow(true)
          // Stamp shown_at server-side as soon as we render. Fire-and-
          // forget; if it fails the user just sees the modal once more
          // on the next visit, which is fine.
          fetch('/api/announcements/seen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surface: 'feedback_survey_shown' }),
          }).catch(() => {})
        }, 3000)
      } catch { /* silent */ }
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const dismiss = () => {
    setShow(false)
    localStorage.setItem(STORAGE_DISMISSED, 'true')
    // Cross-device dismiss (review-2026-04-26-A3) so the next browser
    // / incognito session doesn't re-fire the survey for this user.
    fetch('/api/announcements/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface: 'feedback_survey_dismissed' }),
    }).catch(() => {})
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
      // Backend stores the canonical (DE) tokens so aggregations stay stable
      // regardless of the user's UI language at submit time.
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
        lang,
      }

      // Build a readable summary — always in DE for operational consistency
      // (the internal ops team reviews these)
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

      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          context: surveyPayload,
        }),
      })
      // A rejected save (429/413/5xx) must not mark the survey completed.
      if (!response.ok) throw new Error('Survey submission failed')

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

  const title = step === 4 ? t('survey_success_title', lang) : t('survey_title', lang)
  const description = step < 4 ? t('survey_step_label', lang).replace('{current}', String(step)) : undefined

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
              {t('survey_later', lang)}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goStep(step - 1)}
              className="mp-btn mp-btn--secondary"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
              {t('survey_back', lang)}
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
              {t('survey_next', lang)}
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
                  {t('survey_skip', lang)}
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
                    {t('survey_sending', lang)}
                  </span>
                ) : (
                  <>
                    {t('survey_submit', lang)}
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

  const greeting = t('survey_intro_greeting', lang).replace('{name}', firstName ? `, ${firstName}` : '')

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
              {t('survey_badge', lang)}
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
            {greeting}
          </p>

          {RATING_QUESTION_KEYS.map((qKey, qi) => (
            <div key={qKey}>
              <p className="text-sm font-medium text-[var(--mp-fg)] mb-2">
                {t(qKey, lang)}
              </p>
              <div className="flex gap-2">
                {RATING_LABELS.map((rl, ri) => {
                  const value = ri + 1
                  const selected = ratings[qi] === value
                  const labelText = t(rl.key, lang)
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
                      aria-label={`${labelText} (${value}/5)`}
                    >
                      <span className="text-xl leading-none">{rl.emoji}</span>
                      <span
                        className={`text-[10px] leading-tight ${
                          selected
                            ? 'text-[var(--mp-cta-blue)] font-semibold'
                            : 'text-[var(--mp-fg-subtle)]'
                        }`}
                      >
                        {labelText}
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
              {t('survey_best_title', lang)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {BEST_FEATURE_KEYS.map(featKey => {
                const featDe = t(featKey, 'de')
                const checked = bestFeatures.includes(featDe)
                return (
                  <button
                    key={featKey}
                    type="button"
                    onClick={() => toggleCheckbox(bestFeatures, setBestFeatures, featDe)}
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
                      {t(featKey, lang)}
                    </span>
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              placeholder={t('survey_other_placeholder', lang)}
              value={bestOther}
              onChange={e => setBestOther(e.target.value)}
              maxLength={200}
              className="mt-2 w-full text-sm bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--mp-viridian)]/50 text-[var(--mp-fg)] placeholder:text-[var(--mp-fg-subtle)]"
              aria-label={t('survey_other_best_aria', lang)}
            />
          </div>

          {/* Improvements */}
          <div>
            <p className="text-sm font-medium text-[var(--mp-fg)] mb-3">
              {t('survey_improve_title', lang)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {IMPROVE_KEYS.map(optKey => {
                const optDe = t(optKey, 'de')
                const checked = improvements.includes(optDe)
                return (
                  <button
                    key={optKey}
                    type="button"
                    onClick={() => toggleCheckbox(improvements, setImprovements, optDe)}
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
                      {t(optKey, lang)}
                    </span>
                  </button>
                )
              })}
            </div>
            <input
              type="text"
              placeholder={t('survey_other_placeholder', lang)}
              value={improveOther}
              onChange={e => setImproveOther(e.target.value)}
              maxLength={200}
              className="mt-2 w-full text-sm bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--mp-warning)]/50 text-[var(--mp-fg)] placeholder:text-[var(--mp-fg-subtle)]"
              aria-label={t('survey_other_improve_aria', lang)}
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
            {t('survey_open_title', lang)}
          </p>
          <Textarea
            label={t('survey_open_label', lang)}
            hideLabel
            helper={t('survey_open_helper', lang)}
            value={openText}
            onChange={e => setOpenText(e.target.value)}
            placeholder={t('survey_open_placeholder', lang)}
            maxLength={1200}
            rows={6}
          />
        </div>
      )}

      {/* ═══ STEP 4: Success ═══ */}
      {step === 4 && (
        <div className="py-4 text-center animate-scale-in">
          <div className="relative inline-block mb-4">
            <span className="text-5xl">🎉</span>
            {/* Confetti particles are decorative — wrapped in a class
                that's only animated when motion is allowed (gated by the
                @media (prefers-reduced-motion: no-preference) block in
                the keyframe stylesheet below). */}
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className="absolute w-2 h-2 rounded-full mp-confetti-particle"
                aria-hidden
                style={{
                  backgroundColor: ['var(--mp-viridian)', 'var(--mp-status-warning)', 'var(--mp-cta-blue)', 'var(--mp-accent-teal)', 'var(--mp-error)'][i % 5],
                  top: '50%',
                  left: '50%',
                  animationDelay: `${i * 0.04}s`,
                  opacity: 0,
                  transform: `rotate(${i * 30}deg) translateY(0)`,
                }}
              />
            ))}
          </div>
          <p className="text-sm text-[var(--mp-fg-subtle)]">
            {t('survey_success_body', lang)}
          </p>
        </div>
      )}

      {/* Keyframe animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        /* Confetti only fires when the user hasn't asked for reduced
           motion. Reduced-motion users see the static 🎉 emoji + the
           "Thanks for the feedback" body text — same celebratory tone,
           no flying particles. */
        @media (prefers-reduced-motion: no-preference) {
          @keyframes confetti-burst {
            0% { opacity: 1; transform: rotate(var(--r, 0deg)) translateY(0) scale(1); }
            100% { opacity: 0; transform: rotate(var(--r, 0deg)) translateY(-60px) scale(0.5); }
          }
          .mp-confetti-particle {
            animation: confetti-burst 0.8s ease-out forwards;
          }
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
