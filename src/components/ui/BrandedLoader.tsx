'use client'

import { HbLogomark, HbWordmark, HB_TRACE_PATH, HB_MINI_TRACE_PATH } from './brandMarks'
import { t, useLang } from '@/lib/i18n'

/**
 * BrandedLoader — MPDS HEARTBEAT loader (v3, 2026-06-26).
 *
 * An ECG sinus trace draws left→right; the brand's two ü-dots ARE the two
 * R-wave peaks and pulse on the beat with a spark halo; the trace settles
 * and the MedPrüf lockup resolves in beneath it. Reads like a patient
 * monitor coming alive. Replaces the earlier travelling-EKG loader.
 *
 * Motion lives in globals.css (`.mp-hb-*` keyframes); this component only
 * emits the markup. `prefers-reduced-motion` is honored there (trace
 * settles fully drawn, dots static on their peaks, lockup at rest).
 *
 * Variants (one motion language, three call shapes):
 *   <BrandedLoader fullscreen />        // glyph + lockup + caption, overlay — full 3.6s loop
 *   <BrandedLoader />                    // glyph + caption (~120px), glyph-led full loop
 *   <BrandedLoader size={60} hideLabel/> // compact glyph only — fast 1.8s loop (route transitions)
 *
 * API preserved from the previous implementation so every call site
 * (quiz, exam, flashcards, settings, stats, admin, pricing, etc.) keeps
 * working. `size` drives the glyph width.
 */

interface BrandedLoaderProps {
  size?: number
  label?: string
  /** Renders as a centered overlay filling the viewport. */
  fullscreen?: boolean
  /** Hide the label/caption entirely (for inline/compact uses). */
  hideLabel?: boolean
  className?: string
}

export function BrandedLoader({
  size = 120,
  label,
  fullscreen,
  hideLabel,
  className,
}: BrandedLoaderProps) {
  // UX-ONB-39: the default accessible name follows the UI language.
  const uiLang = useLang()
  const name = label ?? t('a22_loading', uiLang)
  // Compact variant: a small, fast EKG (no lockup, no caption) for route
  // transitions. Anything <= 72px reads as "inline/compact".
  const compact = size <= 72 && !fullscreen

  if (compact) {
    return (
      <div
        className={`inline-flex items-center justify-center ${className ?? ''}`}
        role="status"
        aria-live="polite"
        aria-label={name}
      >
        <div className="mp-hb-mini" style={{ width: size }} aria-hidden>
          <svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg">
            <path className="mp-hb-base" d="M0 50 H300" />
            <path className="mp-hb-trace" d={HB_MINI_TRACE_PATH} />
            <circle className="mp-hb-dot" cx="105" cy="78" r="5.5" />
          </svg>
        </div>
      </div>
    )
  }

  // Default + fullscreen: the wide ü-dots-on-the-R-peaks glyph.
  const glyphWidth = fullscreen ? 340 : size

  const glyph = (
    <div
      className={`flex flex-col items-center justify-center ${className ?? ''}`}
      role="status"
      aria-live="polite"
      aria-label={name}
    >
      <div className="mp-hb" style={{ width: glyphWidth, maxWidth: '100%' }} aria-hidden>
        <svg viewBox="0 0 340 120" xmlns="http://www.w3.org/2000/svg">
          <path className="mp-hb-base" d="M6 70 H334" />
          <path className="mp-hb-trace" d={HB_TRACE_PATH} />
          {/* spark halos at the two R-peaks */}
          <circle className="mp-hb-halo" cx="128" cy="20" r="9" />
          <circle className="mp-hb-halo h2" cx="212" cy="20" r="9" />
          {/* the ü-dots riding the R-peaks */}
          <circle className="mp-hb-dot" cx="128" cy="20" r="7" />
          <circle className="mp-hb-dot d2" cx="212" cy="20" r="7" />
        </svg>
      </div>

      {/* The lockup resolves in beneath the trace — fullscreen only. */}
      {fullscreen && (
        <div className="mp-hb-lockup" aria-hidden>
          <HbLogomark />
          <HbWordmark />
        </div>
      )}

      {!hideLabel && (
        <div className={`mp-hb-caption ${fullscreen ? '' : 'static'}`}>
          <span className="sub">{label ? label : 'medprüf · sinus rhythm'}</span>
        </div>
      )}
    </div>
  )

  if (fullscreen) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--mp-surface-sunken)]/80 backdrop-blur-sm"
        role="presentation"
      >
        {glyph}
      </div>
    )
  }
  return glyph
}
