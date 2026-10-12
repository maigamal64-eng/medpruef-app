'use client'

/**
 * RatingButton: one rating in the review tray (UX-GLOBAL-34, PRA-61).
 *
 * Neutral surface with a 2 px accent border (3:1 against the surface); the
 * label is 14 px bold in --mp-fg and the icon carries the hue:
 *   0 again  → error        1 hard → warning text
 *   2 good   → viridian     3 easy → CTA blue
 * 48 px row, 44 px minimum target. Interval hints are not drawn here: the
 * tray shows the server's real schedule after the tap (RatingRow).
 * While `busy` the pressed button shows a spinner without dimming and every
 * button ignores activation (aria-disabled, focus kept).
 */
import { forwardRef } from 'react'

export type RatingIntensity = 0 | 1 | 2 | 3

export const RATING_ACCENT: Record<RatingIntensity, string> = {
  0: 'var(--mp-error)',
  1: 'var(--mp-warning-text, var(--mp-status-warning))',
  2: 'var(--mp-viridian)',
  3: 'var(--mp-cta-blue)',
}

export interface RatingButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  intensity: RatingIntensity
  icon?: React.ReactNode
  /** The row is waiting for a save; this button shows the spinner when `pressed`. */
  busy?: boolean
  pressed?: boolean
  className?: string
  children?: React.ReactNode
}

export const RatingButton = forwardRef<HTMLButtonElement, RatingButtonProps>(
  function RatingButton({ intensity, icon, busy, pressed, className, children, onClick, disabled, ...rest }, ref) {
    const accent = RATING_ACCENT[intensity]
    return (
      <button
        ref={ref}
        type="button"
        className={[
          'mp-rating-btn focus-visible:outline-2 focus-visible:outline-[var(--mp-focus-color,var(--mp-viridian))] focus-visible:outline-offset-2',
          'min-h-[48px] min-w-[44px] px-2 py-2 text-sm font-bold border-2 rounded-[var(--mp-r-button)]',
          'flex items-center justify-center gap-1.5 bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]',
          className,
        ].filter(Boolean).join(' ')}
        style={{ borderColor: accent }}
        disabled={disabled}
        aria-disabled={busy || disabled || undefined}
        aria-busy={(busy && pressed) || undefined}
        onClick={(event) => { if (busy) { event.preventDefault(); return } onClick?.(event) }}
        {...rest}
      >
        {busy && pressed ? (
          <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: accent }} aria-hidden />
        ) : icon ? (
          <span style={{ color: accent }} className="inline-flex" aria-hidden>{icon}</span>
        ) : null}
        <span>{children}</span>
      </button>
    )
  },
)
