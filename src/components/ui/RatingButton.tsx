'use client'

/**
 * RatingButton — MPDS v2 flashcard confidence-rating button primitive.
 *
 * Eliminates the 18 inline `style={{}}` blocks in src/app/flashcards/page.tsx.
 * Each button maps to one of four SM-2 confidence intensities:
 *
 *   0 = "again"  → warning orange  (var(--mp-warning))
 *   1 = "hard"   → amber           (var(--mp-status-warning))
 *   2 = "good"   → viridian green  (var(--mp-viridian))
 *   3 = "easy"   → CTA blue        (var(--mp-cta-blue))
 *
 * Reproduces the live styling from flashcards/page.tsx exactly:
 * `min-h-[56px] py-3 rounded-xl text-sm font-bold transition-all border-2 active:scale-95`
 * with the canonical radius token (`--mp-r-button`, 12px) replacing `rounded-xl`.
 *
 * Usage:
 *   <RatingButton intensity={0} sublabel="< 10 min" onClick={() => rate("again")}>
 *     Nochmal
 *   </RatingButton>
 *   <RatingButton intensity={2} sublabel="4 Tage" onClick={() => rate("good")}>
 *     Gut
 *   </RatingButton>
 *
 * The `intensity` prop drives all colour — no `style` prop at the call-site.
 */

import { forwardRef } from 'react'

export type RatingIntensity = 0 | 1 | 2 | 3

/** CSS custom property values for border + text, matching ratingColor() in flashcards. */
const INTENSITY_COLOR: Record<RatingIntensity, string> = {
  0: 'var(--mp-warning)',
  1: 'var(--mp-status-warning)',
  2: 'var(--mp-viridian)',
  3: 'var(--mp-cta-blue)',
}

export interface RatingButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  /**
   * Confidence level:
   *   0 = again (warning)
   *   1 = hard  (amber)
   *   2 = good  (viridian)
   *   3 = easy  (CTA blue)
   */
  intensity: RatingIntensity
  /** Small scheduling hint shown below the label, e.g. "< 10 min". */
  sublabel?: string
  className?: string
  children?: React.ReactNode
}

export const RatingButton = forwardRef<HTMLButtonElement, RatingButtonProps>(
  function RatingButton({ intensity, sublabel, className, children, ...rest }, ref) {
    const color = INTENSITY_COLOR[intensity]

    return (
      <button
        ref={ref}
        type="button"
        className={[
          // Reproduces the live base chain from flashcards/page.tsx
          'focus-visible:outline-2 focus-visible:outline-[var(--mp-viridian)] focus-visible:outline-offset-2 min-h-[56px] py-3 text-sm font-bold transition-all border-2 active:scale-95',
          'flex flex-col items-center justify-center gap-0.5',
          // Canonical radius (12px = --mp-r-button) replaces rounded-xl
          'rounded-[var(--mp-r-button)]',
          'bg-[var(--mp-surface-raised)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        // Color from token — eliminates the inline style={} at every call-site
        style={{
          borderColor: color,
          color,
        }}
        {...rest}
      >
        <span>{children}</span>
        {sublabel && (
          <span className="text-[10px] font-mono opacity-60">{sublabel}</span>
        )}
      </button>
    )
  },
)
