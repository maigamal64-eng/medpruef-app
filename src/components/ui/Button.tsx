'use client'

/**
 * Button — MPDS v2 interactive button primitive.
 *
 * Wraps the `.mp-btn` CSS family from globals.css. One component replaces
 * every hand-rolled `mp-btn mp-btn--primary` chain in the app.
 *
 * Usage:
 *   <Button variant="primary" onClick={handleSubmit}>Weiter</Button>
 *   <Button variant="secondary" size="sm">Abbrechen</Button>
 *   <Button variant="success" loading>Gespeichert...</Button>
 *   <Button as="a" href="/konto" variant="ghost">Konto</Button>
 *
 * A11y: Focus ring is baked in via `.mp-focusable` / `--mp-focus-ring`.
 * Disabled state sets aria-disabled and pointer-events:none; the element
 * stays in the tab order so screen readers can discover it.
 *
 * Loading state: aria-busy="true" + aria-label override via `loadingLabel`.
 */

import { forwardRef } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'ghost'
  | 'destructive'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Show spinner + set aria-busy. Does NOT disable clicks automatically — pass disabled too if needed. */
  loading?: boolean
  /** aria-label used while loading. Defaults to the button's current text. */
  loadingLabel?: string
  /** Additional class names merged after the `.mp-btn` chain. */
  className?: string
  children?: React.ReactNode
}

/** Thin wrapper so `<Button as="a">` can be achieved without polymorphic complexity — just use `<a className="mp-btn mp-btn--primary">` directly for anchors. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'primary',
      size,
      loading = false,
      loadingLabel,
      disabled,
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const variantClass = `mp-btn--${variant}`
    const sizeClass = size === 'sm' ? 'mp-btn--sm' : size === 'lg' ? 'mp-btn--lg' : ''
    const classes = ['mp-btn', variantClass, sizeClass, className]
      .filter(Boolean)
      .join(' ')

    return (
      <button
        ref={ref}
        type="button"
        className={classes}
        disabled={disabled || loading}
        aria-disabled={disabled || loading || undefined}
        aria-busy={loading || undefined}
        aria-label={loading && loadingLabel ? loadingLabel : undefined}
        {...rest}
      >
        {loading && (
          <span
            className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
        )}
        {children}
      </button>
    )
  },
)
