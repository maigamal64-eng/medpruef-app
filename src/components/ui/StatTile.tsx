'use client'

/**
 * StatTile — MPDS v2 stat display primitive.
 *
 * Wraps `.mp-stat`, `.mp-stat__label`, `.mp-stat__value`, `.mp-stat__trend`
 * from globals.css. Replaces hand-rolled stat tiles on the stats page
 * (src/app/stats/page.tsx).
 *
 * Usage:
 *   <StatTile label="Fragen gesamt" value={420} />
 *   <StatTile label="Richtig" value="87%" trend={{ direction: "up", text: "+5% diese Woche" }} />
 *   <StatTile label="Fehler" value={12} trend={{ direction: "down", text: "-3 heute" }} />
 *
 * The `value` prop accepts a string or number — the component does not
 * format it; pass pre-formatted strings (e.g. "87%", "4.2h") for precision.
 */

export interface StatTileTrend {
  direction: 'up' | 'down' | 'neutral'
  text: string
}

export interface StatTileProps {
  label: string
  value: string | number
  trend?: StatTileTrend
  className?: string
}

export function StatTile({ label, value, trend, className }: StatTileProps) {
  const trendClass = trend
    ? trend.direction === 'up'
      ? 'mp-stat__trend mp-stat__trend--up'
      : trend.direction === 'down'
        ? 'mp-stat__trend mp-stat__trend--down'
        : 'mp-stat__trend'
    : undefined

  return (
    <div className={['mp-stat', className].filter(Boolean).join(' ')}>
      <span className="mp-stat__label">{label}</span>
      <span className="mp-stat__value">{value}</span>
      {trend && trendClass && (
        <span className={trendClass}>{trend.text}</span>
      )}
    </div>
  )
}
