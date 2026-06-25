'use client'

/**
 * Card — MPDS v2 surface primitive.
 *
 * Wraps `.mp-card` (and `.mp-card--interactive` for clickable cards) from
 * globals.css. The canonical 16px radius (`--mp-r-card`) is enforced here;
 * no ad-hoc `rounded-*` should appear on card surfaces in B.2+ migrations.
 *
 * Usage:
 *   <Card>
 *     <p>Statistik-Inhalt</p>
 *   </Card>
 *
 *   <Card interactive onClick={handleClick} role="button" tabIndex={0}>
 *     Klickbare Karte
 *   </Card>
 *
 * A11y: when interactive, add role="button" + tabIndex={0} + onKeyDown
 * at the call-site (or use a real <button> with Card styling).
 */

import { forwardRef } from 'react'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Applies `.mp-card--interactive` hover/active effects. */
  interactive?: boolean
  className?: string
  children?: React.ReactNode
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  function Card({ interactive = false, className, children, ...rest }, ref) {
    const classes = [
      'mp-card',
      interactive ? 'mp-card--interactive' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div ref={ref} className={classes} {...rest}>
        {children}
      </div>
    )
  },
)
