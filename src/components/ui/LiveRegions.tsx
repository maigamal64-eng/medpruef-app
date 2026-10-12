'use client'

/**
 * LiveRegions — the two root live regions fed by announce() (UX-GLOBAL-15).
 * Mount once in the root layout. Portalled to <body> after mount so an open
 * Dialog (which makes the rest of the page inert) never silences them.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nextLiveText, registerAnnouncer, type Politeness } from '@/lib/announce'

export function LiveRegions() {
  const [mounted, setMounted] = useState(false)
  const politeRef = useRef<HTMLDivElement>(null)
  const assertiveRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return
    const timers: ReturnType<typeof setTimeout>[] = []
    registerAnnouncer((text: string, politeness: Politeness) => {
      const el = politeness === 'assertive' ? assertiveRef.current : politeRef.current
      if (!el) return
      // Write on the next frame so a region that just mounted is observed.
      timers.push(setTimeout(() => { el.textContent = nextLiveText(el.textContent ?? '', text) }, 50))
    })
    return () => { registerAnnouncer(null); timers.forEach(clearTimeout) }
  }, [mounted])

  if (!mounted) return null
  return createPortal(
    <div data-mp-keep-live="" className="mp-sr-only">
      <div ref={politeRef} role="status" aria-live="polite" aria-atomic="true" />
      <div ref={assertiveRef} role="alert" aria-live="assertive" aria-atomic="true" />
    </div>,
    document.body,
  )
}
