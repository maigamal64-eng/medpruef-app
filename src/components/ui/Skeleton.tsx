'use client'

/**
 * Skeleton — MPDS v2 placeholder primitive (DD-19).
 *
 * Subtle pulse, theme-aware, respects prefers-reduced-motion (in which
 * case it stays static instead of pulsing).
 *
 * Usage:
 *   <Skeleton className="h-10 w-64" />
 *   <Skeleton variant="text" lines={3} />
 *   <Skeleton variant="card" />
 *   <Skeleton variant="avatar" />
 */

interface SkeletonProps {
  variant?: 'block' | 'text' | 'card' | 'avatar' | 'topic-card' | 'question'
  lines?: number
  className?: string
  style?: React.CSSProperties
}

const base =
  'bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] motion-safe:animate-pulse'

export function Skeleton({ variant = 'block', lines = 3, className, style }: SkeletonProps) {
  if (variant === 'text') {
    return (
      <div className={`space-y-2 ${className ?? ''}`} style={style} aria-hidden>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={`${base} rounded-md h-3`}
            style={{ width: i === lines - 1 ? '60%' : '100%' }}
          />
        ))}
      </div>
    )
  }
  if (variant === 'avatar') {
    return <div className={`${base} rounded-full w-10 h-10 ${className ?? ''}`} style={style} aria-hidden />
  }
  if (variant === 'card') {
    return (
      <div
        className={`${base} rounded-[var(--mp-r-card)] p-4 ${className ?? ''}`}
        style={style}
        aria-hidden
      >
        <div className={`${base} rounded-md h-5 w-2/5 mb-3`} />
        <div className="space-y-2">
          <div className={`${base} rounded-md h-3 w-full`} />
          <div className={`${base} rounded-md h-3 w-11/12`} />
          <div className={`${base} rounded-md h-3 w-3/4`} />
        </div>
      </div>
    )
  }
  if (variant === 'topic-card') {
    return (
      <div
        className={`${base} rounded-[var(--mp-r-card)] p-5 ${className ?? ''}`}
        style={style}
        aria-hidden
      >
        <div className="flex items-center gap-3 mb-4">
          <div className={`${base} rounded-xl w-10 h-10`} />
          <div className={`${base} rounded-md h-4 w-2/3`} />
        </div>
        <div className={`${base} rounded-md h-2 w-full mb-2`} />
        <div className={`${base} rounded-md h-2 w-4/5`} />
      </div>
    )
  }
  if (variant === 'question') {
    return (
      <div className={`space-y-4 ${className ?? ''}`} style={style} aria-hidden>
        <div className={`${base} rounded-md h-3 w-24`} />
        <div className={`${base} rounded-md h-6 w-full`} />
        <div className={`${base} rounded-md h-6 w-5/6`} />
        <div className="space-y-3 mt-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${base} rounded-[var(--mp-r-card)] h-14 w-full`} />
          ))}
        </div>
      </div>
    )
  }
  // default block
  return <div className={`${base} rounded-md ${className ?? ''}`} style={style} aria-hidden />
}
