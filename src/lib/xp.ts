export function calculateXP(isCorrect: boolean, difficulty: number): number {
  if (!isCorrect) return 2
  return 10 + (difficulty - 1) * 5
}

export function getLevelFromXP(xp: number): { level: number; rank: string; progress: number } {
  const levels = [
    { threshold: 0, rank: 'Praktikant' },
    { threshold: 100, rank: 'Famulant' },
    { threshold: 300, rank: 'PJ-Student' },
    { threshold: 600, rank: 'Assistenzarzt' },
    { threshold: 1000, rank: 'Facharzt' },
    { threshold: 2000, rank: 'Oberarzt' },
    { threshold: 4000, rank: 'Chefarzt' },
    { threshold: 8000, rank: 'Professor' },
  ]
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
