'use client'

/**
 * Option — the one answer row (UX-GLOBAL-25).
 *
 * Used by the quiz, the exam runner, exam review, /history and flashcard
 * backs. States:
 *
 *   idle        not answered, not picked
 *   selected    not answered, picked
 *   correct     graded/revealed: correct AND the learner's pick
 *   wrong       graded/revealed: the learner's pick, not correct
 *   missed      graded/revealed: correct, not picked
 *   disabled    graded/revealed: neither picked nor correct (neutral row)
 *   revealed    the correct answer shown without a learner pick (card back)
 *
 * After grading or reveal there is no opacity anywhere: option text stays in
 * --mp-fg, neutral rows in --mp-fg-muted. State is shown by border, tint, a
 * text tag and a trailing Lucide icon (Check, X), never colour alone. One
 * tag vocabulary everywhere, matching the screen-reader text:
 *   "Ihre Wahl, richtig" · "Ihre Wahl, falsch" · "Richtig, nicht gewählt"
 * Correct uses --mp-viridian (never teal). A correct option that was not
 * picked gets a dashed viridian border. The letter stays for the life of the
 * question and is filled viridian when the option is correct.
 *
 * Semantics (UX-GLOBAL-23): single-select options are buttons with
 * aria-pressed inside a role=group labelled by the stem; multi-select
 * options are checkboxes. After grading the row stays focusable
 * (aria-disabled) so its text and outcome can be read, and it cannot be
 * graded again; `onGradedClick` lets the quiz answer a tap on it by showing
 * the explanation (no dead click). `static` renders a non-interactive row for review lists.
 */

import { forwardRef } from 'react'
import { Check, X } from 'lucide-react'
import { t, useLang, type TranslationKey } from '@/lib/i18n'

export type OptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'missed' | 'disabled' | 'revealed'

export interface OptionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual + semantic state of this option. */
  state?: OptionState
  /** Letter badge (A, B, C…). Omit for image-only options. */
  letter?: string
  /** Checkbox semantics for multi-select questions. */
  multiSelect?: boolean
  /** Learner's selection (aria-pressed / aria-checked). */
  checked?: boolean
  /** Override the outcome tag text (rarely needed; the vocabulary is built in). */
  resultLabel?: string
  /**
   * Tap on a graded row (a-search-fixes-1027): the quiz brings the explanation
   * into view. The row stays aria-disabled because it cannot be graded again.
   */
  onGradedClick?: () => void
  /** Non-interactive review row (history, exam review). */
  static?: boolean
  className?: string
  children?: React.ReactNode
}

const GRADED: ReadonlySet<OptionState> = new Set(['correct', 'wrong', 'missed', 'disabled', 'revealed'])

/** Tag i18n key per graded state (null = no tag). Exported for tests. */
export function optionTagKey(state: OptionState): TranslationKey | null {
  switch (state) {
    case 'correct': return 'option_tag_chosen_correct'
    case 'wrong': return 'option_tag_chosen_wrong'
    case 'missed': return 'option_tag_missed'
    case 'revealed': return 'option_tag_correct_answer'
    default: return null
  }
}

/** Map parent-owned grading to a state. */
export function optionStateFor(input: { answered: boolean; selected: boolean; correct: boolean }): OptionState {
  if (!input.answered) return input.selected ? 'selected' : 'idle'
  if (input.correct) return input.selected ? 'correct' : 'missed'
  return input.selected ? 'wrong' : 'disabled'
}

const ROW: Record<OptionState, string> = {
  idle: 'bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-control)] text-[var(--mp-fg)] hover:border-[var(--mp-viridian)] hover:bg-[var(--mp-surface-high)] active:scale-[0.99]',
  selected: 'bg-[var(--mp-tint-viridian)] border-[1.5px] border-[var(--mp-viridian)] text-[var(--mp-fg)] active:scale-[0.99]',
  correct: 'bg-[color-mix(in_srgb,var(--mp-viridian)_12%,transparent)] border-2 border-[var(--mp-viridian)] text-[var(--mp-fg)] animate-answer-correct',
  revealed: 'bg-[color-mix(in_srgb,var(--mp-viridian)_12%,transparent)] border-2 border-[var(--mp-viridian)] text-[var(--mp-fg)]',
  missed: 'bg-[var(--mp-surface-raised)] border-[1.5px] border-dashed border-[var(--mp-viridian)] text-[var(--mp-fg)]',
  wrong: 'bg-[color-mix(in_srgb,var(--mp-error)_10%,transparent)] border-2 border-[var(--mp-error)] text-[var(--mp-fg)] animate-answer-wrong',
  disabled: 'bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] text-[var(--mp-fg-muted)]',
}

function badgeClass(state: OptionState): string {
  if (state === 'correct' || state === 'missed' || state === 'revealed') return 'bg-[var(--mp-viridian)] text-[var(--mp-fg-on-viridian)]'
  if (state === 'wrong') return 'bg-[var(--mp-error)] text-[var(--mp-fg-on-error)]'
  if (state === 'selected') return 'bg-[var(--mp-viridian)] text-[var(--mp-fg-on-viridian)]'
  return 'bg-[var(--mp-surface-raised)] text-[var(--mp-fg-muted)] border border-[var(--mp-border-control)]'
}

function tagClass(state: OptionState): string {
  return state === 'wrong' ? 'text-[var(--mp-error-text)]' : 'text-[var(--mp-success-text)]'
}

export const Option = forwardRef<HTMLButtonElement, OptionProps>(
  function Option(
    {
      state = 'idle',
      letter,
      multiSelect = false,
      checked,
      resultLabel,
      static: isStatic = false,
      className,
      children,
      disabled,
      onClick,
      onGradedClick,
      ...rest
    },
    ref,
  ) {
    const lang = useLang()
    const graded = GRADED.has(state)
    const tagKey = optionTagKey(state)
    const tag = resultLabel ?? (tagKey ? t(tagKey, lang) : undefined)
    const TrailingIcon = state === 'wrong' ? X : state === 'correct' || state === 'missed' || state === 'revealed' ? Check : null

    const classes = [
      'w-full text-left px-4 py-3 min-h-[52px] text-[15px] font-medium leading-snug',
      'transition-colors duration-150 flex items-center gap-3',
      'rounded-[var(--mp-r-card)]',
      ROW[state],
      graded && onGradedClick ? 'cursor-pointer' : null,
      className,
    ].filter(Boolean).join(' ')

    const content = (
      <>
        <span
          className={['flex-shrink-0 w-7 h-7 flex items-center justify-center text-sm font-bold rounded-[var(--mp-r-button)] select-none', badgeClass(state)].join(' ')}
          aria-hidden
        >
          {letter ?? ''}
        </span>
        <span className="flex-1 min-w-0 text-left">
          {children}
          {tag && <span className={`block mt-1 text-[13px] font-semibold ${tagClass(state)}`}>{tag}</span>}
        </span>
        {TrailingIcon && <TrailingIcon className={`w-5 h-5 flex-shrink-0 ${state === 'wrong' ? 'text-[var(--mp-error)]' : 'text-[var(--mp-viridian)]'}`} aria-hidden strokeWidth={2.5} />}
      </>
    )

    if (isStatic) {
      return <div className={classes} data-option-state={state}>{content}</div>
    }

    const inert = disabled || graded
    return (
      <button
        ref={ref}
        type="button"
        className={classes}
        data-option-state={state}
        role={multiSelect ? 'checkbox' : undefined}
        aria-checked={multiSelect ? (checked ?? false) : undefined}
        aria-pressed={!multiSelect ? (checked ?? state === 'selected') : undefined}
        aria-disabled={inert || undefined}
        onClick={inert ? (graded ? onGradedClick : undefined) : onClick}
        {...rest}
      >
        {content}
      </button>
    )
  },
)
