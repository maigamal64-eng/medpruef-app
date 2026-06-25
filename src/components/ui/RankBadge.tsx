'use client'

/**
 * RankBadge — MPDS v2 rank display composite.
 *
 * Composes `<AchievementRank>` (the `.mp-rank` glyph chip) with an optional
 * rank name label beneath it. Use for user profile headers, leaderboards,
 * and sidebar user cards.
 *
 * This is NOT a second `.mp-rank` primitive — it delegates all glyph
 * rendering to `<AchievementRank>` and adds the label layer only.
 *
 * Usage:
 *   <RankBadge tier={2} showLabel />
 *   <RankBadge tier={0} size="sm" />
 *   <RankBadge tier={userTier} size="lg" showLabel className="mb-4" />
 *
 * For standalone rank glyphs without a label, use `<AchievementRank>` directly.
 */

import { AchievementRank, RANK_NAMES_BY_TIER, type RankTier } from './AchievementRank'

const SIZE_MAP = { sm: 28, md: 40, lg: 56 } as const

export interface RankBadgeProps {
  /** Rank tier 1–8 — matches AchievementRank. */
  tier: RankTier
  /** Glyph chip size. Defaults to "md" (40px). */
  size?: 'sm' | 'md' | 'lg'
  /** Render the localized rank name beneath the glyph. */
  showLabel?: boolean
  className?: string
}

export function RankBadge({ tier, size = 'md', showLabel = false, className }: RankBadgeProps) {
  return (
    <div
      className={['flex flex-col items-center gap-1', className]
        .filter(Boolean)
        .join(' ')}
    >
      <AchievementRank tier={tier} size={SIZE_MAP[size]} />
      {showLabel && (
        <span
          className="text-[11px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]"
          aria-label={`Rang: ${RANK_NAMES_BY_TIER[tier]}`}
        >
          {RANK_NAMES_BY_TIER[tier]}
        </span>
      )}
    </div>
  )
}
