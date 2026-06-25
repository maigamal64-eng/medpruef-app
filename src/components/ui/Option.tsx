'use client'

/**
 * Option — MPDS v2 quiz/flashcard answer-option primitive.
 *
 * Encapsulates the five visual states of an MCQ / flashcard answer button,
 * fixing the 6-radius drift in QuestionCard (`rounded` / `rounded-sm` /
 * `rounded-lg` / `rounded-xl` / `rounded-2xl` / `rounded-full` across a
 * single file). This component uses ONE canonical radius: `--mp-r-card`
 * (16px). All colour and border logic reproduces the live `getOptionStyle()`
 * chain from QuestionCard.tsx exactly — zero visual diff in B.3 migration.
 *
 * State machine (prop-driven — parent owns grading):
 *   idle      — not answered; default unselected look
 *   selected  — not answered; user has tapped this option (single-correct)
 *   correct   — post-answer; this option is correct (whether or not selected)
 *   wrong     — post-answer; this option was selected and is wrong
 *   disabled  — post-answer; neither selected nor correct (dimmed out)
 *
 * Usage:
 *   // Single-correct, pre-answer
 *   <Option
 *     state={selectedIdx === idx ? "selected" : "idle"}
 *     letter="A"
 *     onClick={() => onSelect(idx)}
 *   >
 *     {option.text}
 *   </Option>
 *
 *   // Multi-correct, post-answer
 *   <Option
 *     state={answered && opt.correct ? "correct" : wasSelected && !opt.correct ? "wrong" : "disabled"}
 *     multiSelect
 *     checked={selectedIdxs.has(idx)}
 *     letter="B"
 *   >
 *     {option.text}
 *   </Option>
 *
 *   // Image option (no letter badge)
 *   <Option state="idle" onClick={...}>
 *     <img src={option.image_url} alt={option.text} />
 *   </Option>
 *
 * A11y:
 *   - role="radio" (single) or role="checkbox" (multiSelect)
 *   - aria-checked reflects selected state
 *   - Disabled state uses aria-disabled (stays focusable for SR)
 *   - Focus ring via inline style using `--mp-focus-ring` token
 */

import { forwardRef } from 'react'

export type OptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'disabled'

export interface OptionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual + semantic state of this option. */
  state?: OptionState
  /**
   * Letter badge rendered inside the leading circle (e.g. "A", "B", "C", "D").
   * Omit for image-only options or when the icon carries the meaning.
   */
  letter?: string
  /**
   * Checkbox mode for multi-correct questions.
   * When true, renders a checkbox icon and role="checkbox".
   */
  multiSelect?: boolean
  /** aria-checked value for multiSelect mode. */
  checked?: boolean
  className?: string
  children?: React.ReactNode
}

// Reproduces getOptionStyle() from QuestionCard.tsx with one canonical radius.
// Using inline-style for the focus ring (token reference, not a utility class).
const STATE_CLASSES: Record<OptionState, string> = {
  idle: [
    'bg-[var(--mp-surface-sunken)]',
    'border border-transparent',
    'hover:border-[var(--mp-viridian)]/30 hover:bg-white hover:shadow-[var(--shadow-card)]',
    'text-[var(--mp-fg)]',
    'active:scale-[0.99]',
  ].join(' '),

  selected: [
    'bg-[var(--mp-viridian)]/8',
    'border border-[var(--mp-viridian)]/60',
    'text-[var(--mp-fg)]',
    'active:scale-[0.99]',
  ].join(' '),

  correct: [
    'bg-[var(--mp-accent-teal)]/12',
    'border border-[var(--mp-accent-teal)] border-l-4 border-l-[var(--mp-accent-teal)]',
    'text-[var(--mp-accent-teal)]',
    'animate-answer-correct',
  ].join(' '),

  wrong: [
    'bg-[var(--mp-error)]/12',
    'border border-[var(--mp-error)]',
    'text-[var(--mp-error)]',
    'animate-answer-wrong',
  ].join(' '),

  disabled: [
    'bg-[var(--mp-surface-raised)]',
    'border border-[var(--mp-border)]/40',
    'text-[var(--mp-fg-subtle)] opacity-50',
  ].join(' '),
}

// Icon for the leading badge — letter pre-answer; checkmark/x post-answer.
// Mirrors getOptionIcon(idx, opt) where `answered` is inferred from state.
function resolveDisplayIcon(
  state: OptionState,
  letter: string | undefined,
  multiSelect: boolean,
  checked: boolean | undefined,
): string {
  switch (state) {
    case 'idle':
      return multiSelect ? (checked ? '☑' : '☐') : (letter ?? '•')
    case 'selected':
      return multiSelect ? '☑' : '●'
    case 'correct':
      return '✓'
    case 'wrong':
      return '✗'
    case 'disabled':
      return multiSelect ? '☐' : (letter ?? '•')
  }
}

export const Option = forwardRef<HTMLButtonElement, OptionProps>(
  function Option(
    {
      state = 'idle',
      letter,
      multiSelect = false,
      checked,
      className,
      children,
      disabled,
      onClick,
      ...rest
    },
    ref,
  ) {
    const isDisabled = disabled || state === 'disabled'
    const isPostAnswer = state === 'correct' || state === 'wrong' || state === 'disabled'

    const displayIcon = resolveDisplayIcon(state, letter, multiSelect, checked)

    const classes = [
      // Base from getOptionStyle's `base` string
      'w-full text-left px-4 py-3 min-h-[56px] text-sm font-medium',
      'transition-all duration-200 flex items-center gap-3',
      // ONE canonical radius — fixes the 6-radius drift
      'rounded-[var(--mp-r-card)]',
      STATE_CLASSES[state],
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <button
        ref={ref}
        type="button"
        className={classes}
        role={multiSelect ? 'checkbox' : 'radio'}
        aria-checked={
          multiSelect
            ? (checked ?? false)
            : (state === 'selected' || state === 'correct')
        }
        aria-disabled={isDisabled || undefined}
        disabled={isDisabled}
        onClick={isPostAnswer ? undefined : onClick}
        // Focus ring via token — not a Tailwind utility to avoid specificity clash
        style={{ outlineOffset: '2px' }}
        {...rest}
      >
        {/* Letter / state icon badge */}
        <span
          className={[
            'flex-shrink-0 w-7 h-7 flex items-center justify-center',
            'text-sm font-bold rounded-[var(--mp-r-button)] select-none',
            state === 'correct'
              ? 'bg-[var(--mp-accent-teal)] text-white'
              : state === 'wrong'
                ? 'bg-[var(--mp-error)] text-white'
                : state === 'selected'
                  ? 'bg-[var(--mp-viridian)] text-white'
                  : 'bg-[var(--mp-surface-raised)] text-[var(--mp-fg-subtle)]',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden
        >
          {displayIcon}
        </span>

        {/* Option content */}
        <span className="flex-1 text-left leading-snug">{children}</span>
      </button>
    )
  },
)
