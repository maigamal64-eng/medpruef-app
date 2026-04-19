'use client'

/**
 * BrandedLoader — MPDS v2 loading indicator (picked alt: Loader-A · EKG-Pulse).
 *
 * A travelling sinus-rhythm trace in viridian. Clinical metaphor, domain-
 * native motion. Replaces the earlier ring+ü loader (Loader-B).
 *
 * Usage:
 *   <BrandedLoader />                           // default 120px-wide EKG
 *   <BrandedLoader size={60} hideLabel />       // inline compact
 *   <BrandedLoader fullscreen />                // overlay for route transitions
 *
 * Respects `prefers-reduced-motion` via `@keyframes mp-loader-ekg` in
 * globals.css — when motion is reduced the trace stays centered and
 * static instead of running.
 *
 * API preserved from the previous Loader-B implementation so every call
 * site (quiz, exam, flashcards, settings, stats, etc.) keeps working.
 * `size` now drives the SVG width; height follows the 3:1 EKG aspect.
 */

interface BrandedLoaderProps {
  size?: number
  label?: string
  /** Renders as a centered overlay filling the viewport. */
  fullscreen?: boolean
  /** Hide the label entirely (for inline/compact uses). */
  hideLabel?: boolean
  className?: string
}

// EKG path — flat baseline → QRS complex (spike up, down) → flat → T-wave
// wiggle → flat. Matches the traced-pulse in design-system/preview/
// alt-loader.html (A variant).
const EKG_PATH = 'M0 50 L60 50 L75 50 L90 20 L105 80 L120 30 L135 50 L300 50'

export function BrandedLoader({
  size = 120,
  label,
  fullscreen,
  hideLabel,
  className,
}: BrandedLoaderProps) {
  // The EKG trace is a 300x100 viewbox. We scale width to `size` and keep
  // the 3:1 aspect, matching the alt-spec's 120x40 glyph footprint.
  const width = size
  const height = Math.round(size / 3)

  const pulse = (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${className ?? ''}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
    >
      <div
        className="text-[var(--mp-viridian)]"
        style={{ width, height }}
        aria-hidden
      >
        <svg
          width={width}
          height={height}
          viewBox="0 0 300 100"
          preserveAspectRatio="none"
          style={{ width: '100%', height: '100%' }}
        >
          <path
            d={EKG_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mp-loader-ekg"
          />
        </svg>
      </div>
      {!hideLabel && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-sm font-bold text-[var(--mp-fg)] font-display tracking-[-0.01em]">
            {label ?? 'Laden…'}
          </span>
          <span
            className="text-[11px] font-mono uppercase text-[var(--mp-fg-subtle)]"
            style={{ letterSpacing: '0.1em' }}
          >
            medprüf · sinus rhythm
          </span>
        </div>
      )}
    </div>
  )

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[40] flex items-center justify-center bg-[var(--mp-surface-sunken)]/80 backdrop-blur-sm"
        role="presentation"
      >
        {pulse}
      </div>
    )
  }
  return pulse
}
