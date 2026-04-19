'use client'

/**
 * EmptyState — MPDS v2 primitive for "nothing here yet" surfaces.
 *
 * Redesigned 2026-04-17 from alt-B (primitive system-clean) to alt-A
 * (illustrated, warmer tone). The art surface is now a larger tinted chip
 * holding a big icon or inline illustration, and the copy runs wider for
 * proper MedPrüf voice (e.g. "Tippe auf das Fähnchen…" instead of
 * "No bookmarks yet").
 *
 * Props are additive — existing call-sites keep working. The optional
 * `tone` prop picks the tinted background of the art surface:
 *   • "neutral" (default) — info blue tint, for typical "empty list" states
 *   • "success"           — viridian tint, for positive empties (e.g.
 *                           "All caught up!")
 *   • "warning"           — warning amber tint, for offline / partial states
 *
 * Usage:
 *   <EmptyState
 *     tone="success"
 *     icon={<Bookmark className="w-10 h-10" aria-hidden />}
 *     title="Noch keine Fragen markiert"
 *     body="Tippe auf das Fähnchen bei einer Frage, um sie hier zu sehen. Du kannst alle gemerkten Fragen später im Übungsmodus filtern."
 *     action={<button className="mp-btn mp-btn--secondary">Quiz starten</button>}
 *   />
 */

export type EmptyStateTone = 'neutral' | 'success' | 'warning'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  body?: string
  action?: React.ReactNode
  className?: string
  tone?: EmptyStateTone
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <div className={`mp-empty ${className ?? ''}`}>
      {icon && (
        <div
          className={`mp-empty__art mp-empty__art--${tone}`}
          aria-hidden={true}
        >
          {icon}
        </div>
      )}
      <h3 className="mp-empty__title">{title}</h3>
      {body && <p className="mp-empty__body">{body}</p>}
      {action}
    </div>
  )
}
