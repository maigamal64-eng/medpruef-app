'use client'

/**
 * ProPill: the one visible marker for a Pro-only control (UX-GLOBAL-19).
 * Neutral MPDS surface, the word "Pro" in the text and in the accessible
 * name, never a lock icon alone and never amber. When `href` is given it
 * opens the in-place explanation on /pricing?gate=<gate>.
 */
import Link from 'next/link'

interface ProPillProps {
  /** Sentence read by assistive tech, usually gateSentence(feature, lang). */
  label: string
  href?: string
  className?: string
}

export function ProPill({ label, href, className }: ProPillProps) {
  const classes = `mp-pro-pill ${className ?? ''}`
  if (href) {
    return (
      <Link href={href} className={`${classes} mp-focusable`} aria-label={label} title={label}>
        Pro
      </Link>
    )
  }
  return (
    <span className={classes} title={label}>
      Pro<span className="sr-only">: {label}</span>
    </span>
  )
}
