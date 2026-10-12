export function calculateXP(isCorrect: boolean, difficulty: number): number {
  if (!isCorrect) return 2
  return 10 + (difficulty - 1) * 5
}

/**
 * The 8-level XP ladder. `rank` keeps the legacy career names for existing
 * callers (Sidebar, XPBar, settings, progress, AchievementRank lookup), but
 * learner UI should show the level as a number only (UX-STU-42):
 * rankLabel(level, lang) in src/lib/i18n-study-dash.ts ("Stufe 3 von 8").
 */
const LEVELS: readonly { threshold: number; rank: string }[] = [
  { threshold: 0, rank: 'Praktikant' },
  { threshold: 100, rank: 'Famulant' },
  { threshold: 300, rank: 'PJ-Student' },
  { threshold: 600, rank: 'Assistenzarzt' },
  { threshold: 1000, rank: 'Facharzt' },
  { threshold: 2000, rank: 'Oberarzt' },
  { threshold: 4000, rank: 'Chefarzt' },
  { threshold: 8000, rank: 'Professor' },
]

/** Number of levels on the ladder. */
export const LEVEL_COUNT = LEVELS.length

/** XP needed to reach each level, index 0 = level 1. */
export const XP_LEVEL_THRESHOLDS: readonly number[] = LEVELS.map((l) => l.threshold)

export function getLevelFromXP(xp: number): { level: number; rank: string; progress: number } {
  const levels = LEVELS
  let level = 1
  let rank = 'Praktikant'
  let nextThreshold = 100
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].threshold) {
      level = i + 1
      rank = levels[i].rank
      nextThreshold = levels[i + 1]?.threshold || levels[i].threshold * 2
      break
    }
  }
  const currentThreshold = levels[level - 1]?.threshold || 0
  const progress = Math.min(100, ((xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100)
  return { level, rank, progress }
}

/**
 * Bar geometry toward the next level: the next level number and its XP
 * threshold (null at the top level) and the rounded fill percentage.
 */
export function nextLevelProgress(xp: number): { level: number; nextLevel: number | null; nextThreshold: number | null; pct: number } {
  const safe = Number.isFinite(xp) ? Math.max(0, xp) : 0
  const { level } = getLevelFromXP(safe)
  const current = XP_LEVEL_THRESHOLDS[level - 1] ?? 0
  const next = XP_LEVEL_THRESHOLDS[level] ?? null
  if (next == null) return { level, nextLevel: null, nextThreshold: null, pct: 100 }
  const pct = Math.min(100, Math.max(0, Math.round(((safe - current) / (next - current)) * 100)))
  return { level, nextLevel: level + 1, nextThreshold: next, pct }
}
