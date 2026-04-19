'use client'

/**
 * AchievementRank — MPDS v2 bespoke SVG rank glyphs (DD-04).
 *
 * Replaces the emoji rank icons (🎓📚🩺⚕️🏥🔬👨‍⚕️🏆) in XPBar + the Lucide
 * placeholders in GamificationHero with a consistent, line-art set that
 * scales cleanly from 20px (inline) to 64px (hero badge).
 *
 * Each glyph sits in a 24×24 viewbox, uses currentColor stroke at 1.75
 * weight, and progresses visually: rank 1 is the simplest (a clean
 * stethoscope), rank 8 is the richest (graduation cap wrapped in laurels).
 *
 * Variants:
 *   - "badge"  (default) — 40px rounded gradient chip matching the
 *                          `.mp-rank` convention in globals.css. Glyph
 *                          inherits white on the Oxford→CTA Blue bg.
 *   - "inline" — no background, currentColor only. Use inside compact
 *                rows (e.g. compact XPBar) where the chip would be
 *                visual noise.
 *
 * Accessibility:
 *   - Inherits a rank-aware `aria-label` (e.g. "Rang 3: PJ-Student").
 *   - `role="img"` is set so assistive tech announces the glyph as a
 *     semantic unit rather than a decoration.
 *   - Pass `aria-hidden` via className/wrapper when another adjacent
 *     label already states the rank.
 *
 * Usage:
 *   <AchievementRank tier={3} />                       // 40px badge
 *   <AchievementRank tier={5} size={64} />             // big hero badge
 *   <AchievementRank tier={2} size={20} variant="inline" />  // compact row
 *
 * The component does NOT read user data — callers pass `tier` directly.
 * `rankFromName(name)` is exported as a convenience for existing rank-
 * name call sites (e.g. `getLevelFromXP().rank`).
 */

import type { CSSProperties } from 'react'

export type RankTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const RANK_NAMES_BY_TIER: Record<RankTier, string> = {
  1: 'Praktikant',
  2: 'Famulant',
  3: 'PJ-Student',
  4: 'Assistenzarzt',
  5: 'Facharzt',
  6: 'Oberarzt',
  7: 'Chefarzt',
  8: 'Professor',
}

/** Map a German rank name back to its tier number. Defaults to 1. */
export function rankFromName(name: string | undefined | null): RankTier {
  if (!name) return 1
  const entry = Object.entries(RANK_NAMES_BY_TIER).find(
    ([, v]) => v.toLowerCase() === name.toLowerCase()
  )
  return (entry ? (Number(entry[0]) as RankTier) : 1)
}

interface AchievementRankProps {
  /** Rank tier 1–8. Caller maps from rank name via `rankFromName()`. */
  tier: RankTier
  /** Outer size in px. Default 40. Scales from ~20 to 64. */
  size?: number
  /**
   * - "badge" (default) — gradient Oxford→CTA Blue chip with white glyph.
   * - "inline" — no chip; glyph uses `currentColor` from its parent.
   */
  variant?: 'badge' | 'inline'
  /** Extra classes for the outer element. */
  className?: string
  /** If true, hide from assistive tech (another label narrates rank). */
  'aria-hidden'?: boolean
  /** Override the generated aria-label. */
  'aria-label'?: string
}

/**
 * Glyph set. Each entry is the inner SVG content for a 24×24 viewbox.
 * Strokes rely on the outer `<svg>` attributes so the paths stay compact.
 */
const GLYPHS: Record<RankTier, React.ReactNode> = {
  // 1 · Praktikant — stethoscope. Two curving tubes meet at a chest piece.
  // Clinical entry point; the simplest silhouette of the set.
  1: (
    <>
      <path d="M7 4v5a4 4 0 0 0 8 0V4" />
      <path d="M11 13v3a4 4 0 0 0 8 0v-2" />
      <circle cx="19" cy="11" r="2" />
    </>
  ),

  // 2 · Famulant — open book with a small medical cross on the spine.
  // Reading clinical material; first supervised clinical year.
  2: (
    <>
      <path d="M3 5.5h7a2 2 0 0 1 2 2V20a1.5 1.5 0 0 0-1.5-1.5H3Z" />
      <path d="M21 5.5h-7a2 2 0 0 0-2 2V20a1.5 1.5 0 0 1 1.5-1.5H21Z" />
      <path d="M12 9v4M10 11h4" />
    </>
  ),

  // 3 · PJ-Student — heart glyph with an EKG waveform traversing through it.
  // Practical year: actively caring for patients, rhythm of clinical work.
  3: (
    <>
      <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z" />
      <path d="M5 12h2.5l1.5-3 2 6 1.5-3 1.5 2H19" />
    </>
  ),

  // 4 · Assistenzarzt — medical cross inside a rounded-square frame.
  // Licensed to practice; contained, official, formally credentialed.
  4: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),

  // 5 · Facharzt — same cross, now flanked by twin laurel branches.
  // Specialist certification; earned distinction.
  5: (
    <>
      <path d="M12 6v12M8 12h8" />
      <path d="M5 8c1.5 1 2.5 2.5 3 4M5 12c1.5 1 2.5 2.5 3 4" />
      <path d="M19 8c-1.5 1-2.5 2.5-3 4M19 12c-1.5 1-2.5 2.5-3 4" />
    </>
  ),

  // 6 · Oberarzt — hospital/building silhouette with a cross on the facade.
  // Senior staff; leads a ward, owns a unit.
  6: (
    <>
      <path d="M4 20V9l8-5 8 5v11" />
      <path d="M4 20h16" />
      <path d="M12 10v4M10 12h4" />
    </>
  ),

  // 7 · Chefarzt — three-point crown sitting atop a cross-in-circle.
  // Head physician; the ward's authority.
  7: (
    <>
      <path d="M4 9l3 4 5-6 5 6 3-4v7H4z" />
      <path d="M4 19h16" />
      <path d="M12 12v3M10.5 13.5h3" />
    </>
  ),

  // 8 · Professor — graduation cap crowned by a laurel wreath.
  // Peak: mastery and honor combined.
  8: (
    <>
      <path d="M12 5 3 9l9 4 9-4-9-4Z" />
      <path d="M7 11v4c0 1.5 2.2 3 5 3s5-1.5 5-3v-4" />
      <path d="M4 18c1.5-.3 2.8-1.2 3.5-2.5" />
      <path d="M20 18c-1.5-.3-2.8-1.2-3.5-2.5" />
    </>
  ),
}

export function AchievementRank({
  tier,
  size = 40,
  variant = 'badge',
  className,
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabelOverride,
}: AchievementRankProps) {
  const glyph = GLYPHS[tier] ?? GLYPHS[1]
  const rankName = RANK_NAMES_BY_TIER[tier] ?? RANK_NAMES_BY_TIER[1]
  const label = ariaLabelOverride ?? `Rang ${tier}: ${rankName}`

  // Inner glyph is ~55% of the outer box — matches the 22/40 ratio in .mp-rank.
  const innerSize = Math.round(size * 0.55)

  const commonA11y = ariaHidden
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': label } as const)

  if (variant === 'inline') {
    // No chip — the glyph paints in currentColor, inherits parent color.
    return (
      <svg
        className={className}
        width={innerSize}
        height={innerSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...commonA11y}
      >
        {glyph}
      </svg>
    )
  }

  // Badge variant — gradient chip behind a white-stroke glyph.
  // Radius scales with size so small badges stay visually coherent.
  const radius = Math.max(8, Math.round(size * 0.3))
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    background:
      'linear-gradient(135deg, var(--mp-oxford-blue, #001B3D) 0%, var(--mp-cta-blue, #003A8C) 100%)',
    color: '#FFFFFF',
    flexShrink: 0,
  }

  return (
    <span
      className={`inline-flex items-center justify-center ${className ?? ''}`}
      style={style}
      {...commonA11y}
    >
      <svg
        width={innerSize}
        height={innerSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {glyph}
      </svg>
    </span>
  )
}

export default AchievementRank
