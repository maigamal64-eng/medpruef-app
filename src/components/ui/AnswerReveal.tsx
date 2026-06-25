'use client'

/**
 * AnswerReveal — MPDS v2 post-answer feedback strip primitive.
 *
 * Renders the feedback band that appears below the options after a quiz
 * question is answered. Reproduces the live styling from QuestionCard.tsx
 * (`bg-[var(--mp-surface-sunken)] rounded-xl px-4 py-2.5`) with the
 * canonical radius token replacing `rounded-xl` (Tailwind 12px).
 *
 * The strip hosts `ContextTabs` in full-quiz mode (erklaerung / ki / notizen /
 * uebersetzen / quelle). In B.3 migration, QuestionCard replaces its inline
 * reveal <div> with this primitive and passes ContextTabs as `children`.
 *
 * Usage:
 *   <AnswerReveal correct={isCorrect}>
 *     <p>{question.explanation}</p>
 *   </AnswerReveal>
 *
 *   // With tab panel (full quiz mode):
 *   <AnswerReveal correct={isCorrect}>
 *     <ContextTabs tabs={quizBTabs} activeTab={activeTab} onTabChange={setTab} />
 *     <div>{tabContent}</div>
 *   </AnswerReveal>
 *
 * A11y: role="status" so screen readers announce the reveal on answer.
 */

export interface AnswerRevealProps {
  /** Whether the user answered correctly — controls the accent stripe color. */
  correct: boolean
  className?: string
  children?: React.ReactNode
}

export function AnswerReveal({ correct, className, children }: AnswerRevealProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'bg-[var(--mp-surface-sunken)]',
        // Canonical button radius (12px = --mp-r-button) matches the live rounded-xl in QuestionCard
        'rounded-[var(--mp-r-button)]',
        'px-4 py-2.5',
        // Thin left accent stripe to reinforce correct/wrong at a glance
        'border-l-4',
        correct
          ? 'border-l-[var(--mp-accent-teal)]'
          : 'border-l-[var(--mp-error)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}
