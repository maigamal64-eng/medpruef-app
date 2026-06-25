'use client'

/**
 * NavItem — MPDS v2 navigation item primitive.
 *
 * Unifies the two private `navLinkClass` / `navItemClass` functions in
 * Sidebar.tsx and BottomNav.tsx into a single primitive with two rendering
 * contexts:
 *
 *   context="sidebar"  — dark Oxford Blue rail, left-accent stripe when active,
 *                        expanded (icon + label) or collapsed (icon only) mode.
 *   context="bottom"   — glass bottom bar item, vertical icon+label stack.
 *
 * Reproduces the live class chains exactly — zero visual diff in B.2 migration.
 *
 * Usage:
 *   // Sidebar (expanded)
 *   <NavItem context="sidebar" href="/quiz" icon={<FileText />} label="Quiz" active />
 *
 *   // Sidebar (collapsed rail)
 *   <NavItem context="sidebar" href="/quiz" icon={<FileText />} label="Quiz" active collapsed />
 *
 *   // Bottom nav
 *   <NavItem context="bottom" href="/quiz" icon={<FileText />} label="Quiz" active />
 *
 *   // With nudge dot
 *   <NavItem context="sidebar" href="/referrals" icon={<Gift />} label="Empfehlungen"
 *     dot dotTooltip="Dein Code wartet." />
 *
 * A11y:
 *   - `aria-current="page"` when active (route-level indicator)
 *   - Dot uses role="status" + aria-label from dotTooltip
 *   - Wraps a Next.js `<Link>` — fully keyboard navigable
 */

import Link from 'next/link'

export interface NavItemProps {
  /** Visual rendering context. */
  context: 'sidebar' | 'bottom'
  /** Route href for the Link. */
  href: string
  /** Icon element (Lucide or any React node). Caller controls size. */
  icon: React.ReactNode
  /** Label text. Always rendered; hidden visually in collapsed sidebar mode. */
  label: string
  /** Whether this item is the active route. */
  active?: boolean
  /**
   * Sidebar-only: collapsed rail mode (icon only, no label).
   * Ignored in bottom context.
   */
  collapsed?: boolean
  /** Show an amber nudge dot on this item. */
  dot?: boolean
  /** aria-label for the dot. Rendered as a tooltip on hover. */
  dotTooltip?: string
  className?: string
}

export function NavItem({
  context,
  href,
  icon,
  label,
  active = false,
  collapsed = false,
  dot = false,
  dotTooltip,
  className,
}: NavItemProps) {
  if (context === 'sidebar') {
    // Reproduces navLinkClass(key) from Sidebar.tsx
    const base = collapsed
      ? 'flex items-center justify-center w-9 h-9 mx-auto rounded-lg mb-0.5 transition-all duration-150'
      : 'flex items-center gap-3 px-3 py-2.5 rounded-r-xl mb-px transition-all duration-150'

    const stateClasses = active
      ? collapsed
        ? 'bg-[var(--mp-viridian)]/20 text-[var(--mp-accent-teal)] font-semibold'
        : 'bg-[var(--mp-viridian)]/20 text-[var(--mp-accent-teal)] font-semibold border-l-[3px] border-l-[var(--mp-accent-teal)]'
      : 'text-[var(--mp-fg-subtle)] hover:bg-white/5 hover:text-white'

    return (
      <Link
        href={href}
        className={[base, stateClasses, 'relative', className].filter(Boolean).join(' ')}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? label : undefined}
      >
        <span className="flex-shrink-0" aria-hidden>{icon}</span>
        {!collapsed && <span className="text-sm truncate">{label}</span>}
        {dot && (
          <span
            role="status"
            aria-label={dotTooltip ?? label}
            title={dotTooltip}
            className={[
              'absolute top-1 right-1 w-2 h-2 rounded-full',
              'bg-[var(--mp-warning)] ring-1 ring-[var(--mp-surface-base)]',
              collapsed ? 'top-0.5 right-0.5' : 'top-1.5 right-2',
            ].join(' ')}
          />
        )}
      </Link>
    )
  }

  // context === 'bottom'
  // Reproduces navItemClass(key) from BottomNav.tsx
  const bottomClasses = [
    'flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-xl transition-all duration-200',
    active
      ? 'text-[var(--mp-viridian)]'
      : 'text-[var(--mp-fg-subtle)] active:text-[var(--mp-fg-muted)]',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Link href={href} className={bottomClasses} aria-current={active ? 'page' : undefined}>
      <span aria-hidden>{icon}</span>
      <span
        className={[
          'text-[10px]',
          active ? 'font-semibold text-[var(--mp-viridian)]' : 'font-medium',
        ].join(' ')}
      >
        {label}
      </span>
    </Link>
  )
}
