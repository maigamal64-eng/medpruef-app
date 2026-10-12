'use client'

/**
 * IconButton (UX-HOME-39): one control for every dismiss and icon action.
 * The hit area is always at least 44 x 44 px (the icon may stay 16 px) and
 * the accessible name is required, so a glyph never becomes the name.
 * Callers pass a localised label through t().
 */
import { forwardRef } from 'react'
import { X } from 'lucide-react'

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Required, localised accessible name. */
  label: string
  /** Defaults to a close (X) glyph. */
  icon?: React.ReactNode
  /** Visual tone over coloured surfaces. */
  tone?: 'default' | 'inverse'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, tone = 'default', className = '', type = 'button', ...rest },
  ref,
) {
  const color = tone === 'inverse' ? 'text-white/80 hover:text-white' : 'text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]'
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={`mp-icon-btn inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl mp-focusable ${color} ${className}`}
      {...rest}
    >
      {icon ?? <X className="h-4 w-4" aria-hidden />}
    </button>
  )
})
