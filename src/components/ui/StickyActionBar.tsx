'use client'

/**
 * StickyActionBar — the one fixed action bar in the phone bottom budget
 * (UX-GLOBAL-11): the nav (or nothing in focus mode) plus at most one bar.
 *
 * Opaque surface, top border, elevation token, at most 72 px plus the
 * safe-area inset. It sits above the BottomNav inside the app shell, hides
 * while the soft keyboard is open in a text field (visual viewport shrink)
 * and while the cookie bar is visible (CSS: .mp-cookie-visible).
 *
 * Callers add page padding equal to the bar via the --mp-sticky-action-h
 * variable it publishes.
 */

import { useEffect, useRef, useState } from 'react'

export interface StickyActionBarProps {
  children: React.ReactNode
  /** Accessible name for the action group. */
  label: string
  className?: string
}

export function StickyActionBar({ children, label, className }: StickyActionBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const sync = () => {
      const active = document.activeElement
      const typing = !!active && active.matches?.('input, textarea, select, [contenteditable="true"]')
      setKeyboardOpen(typing && window.innerHeight - vv.height > 120)
    }
    vv.addEventListener('resize', sync)
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      document.removeEventListener('focusin', sync)
      document.removeEventListener('focusout', sync)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!el || typeof ResizeObserver === 'undefined') return
    const publish = () => root.style.setProperty('--mp-sticky-action-h', keyboardOpen ? '0px' : `${Math.ceil(el.getBoundingClientRect().height)}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => { observer.disconnect(); root.style.setProperty('--mp-sticky-action-h', '0px') }
  }, [keyboardOpen])

  return (
    <div ref={ref} role="group" aria-label={label} hidden={keyboardOpen} className={['mp-sticky-action', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
